import "server-only"
import { randomUUID } from "node:crypto"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { eq } from "drizzle-orm"
import postgres from "postgres"

import { appBackends, db, type AppBackendRow } from "@/db"
import type { DataModel } from "@/lib/app-runtime/data-model"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box"

// The data plane of a generated app on CloudHike. CloudHike has no client
// data API (its database is reached with a connection string), so the app
// talks to this server, which holds the project's credentials and talks to
// its Database, Storage and Auth. Credentials never reach the browser or the AI.
//
// Layout in the app's database:
//   app_c_<collection>  one table per collection: id, data jsonb, created_at, updated_at
//   app_settings        key -> jsonb value (useSetting)
//   app_meta            'version': bumped on every write, polled for live sync

export class AppBackendError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

export type AppEnv = Record<string, string>

export async function getBackend(projectId: string): Promise<AppBackendRow | null> {
  const [row] = await db.select().from(appBackends).where(eq(appBackends.projectId, projectId)).limit(1)
  return row ?? null
}

export function readEnv(row: AppBackendRow): AppEnv {
  if (!row.envEnc) throw new AppBackendError("This app's backend isn't set up yet.", 409)
  return JSON.parse(decryptSecret(row.envEnc)) as AppEnv
}

export const sealEnv = (env: AppEnv) => encryptSecret(JSON.stringify(env))

// ---------------------------------------------------------------- database

type Pool = { sql: postgres.Sql; url: string; lastUsed: number }
const g = globalThis as unknown as { __appPools?: Map<string, Pool>; __appPoolSweep?: ReturnType<typeof setInterval> }
const pools = (g.__appPools ??= new Map())
// Free CloudHike databases sleep after idle hours; don't hold connections open for nothing.
g.__appPoolSweep ??= setInterval(() => {
  for (const [id, p] of pools) if (Date.now() - p.lastUsed > 5 * 60_000) void p.sql.end({ timeout: 5 }).finally(() => pools.delete(id))
}, 60_000)
// Housekeeping only: never keeps the process alive.
g.__appPoolSweep.unref?.()

function dbUrl(env: AppEnv) {
  const url = env.DATABASE_URL || env.DIRECT_URL
  if (!url) throw new AppBackendError("The app's CloudHike database isn't ready.", 409)
  return url
}

export function appSql(projectId: string, env: AppEnv): postgres.Sql {
  const url = dbUrl(env)
  const hit = pools.get(projectId)
  if (hit && hit.url === url) {
    hit.lastUsed = Date.now()
    return hit.sql
  }
  if (hit) void hit.sql.end({ timeout: 5 })
  // DATABASE_URL goes through PgBouncer (transaction mode): no prepared statements.
  const sql = postgres(url, { max: 3, prepare: false, idle_timeout: 60, connect_timeout: 20 })
  pools.set(projectId, { sql, url, lastUsed: Date.now() })
  return sql
}

/** A schema change needs a session connection: DIRECT_URL when CloudHike gives one. */
async function withDirect<T>(env: AppEnv, fn: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(env.DIRECT_URL || dbUrl(env), { max: 1, prepare: false, connect_timeout: 30 })
  try {
    return await fn(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const COLLECTION = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/

export function tableName(collection: string) {
  if (!COLLECTION.test(collection)) throw new AppBackendError("Unknown collection.")
  return `app_c_${collection.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
}

const META_DDL = `
create table if not exists app_settings (key text primary key, value jsonb, updated_at timestamptz not null default now());
create table if not exists app_meta (key text primary key, value bigint not null default 0);
insert into app_meta (key, value) values ('version', 0) on conflict (key) do nothing;`

const collectionDdl = (table: string) => `
create table if not exists ${table} (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists ${table}_created_idx on ${table} (created_at desc);`

/**
 * Creates the tables for the app's data model and seeds collections that are
 * still empty. Idempotent, and never deletes data: a revised plan adds tables,
 * it doesn't drop the old ones.
 */
export async function syncSchema(env: AppEnv, model: DataModel) {
  await withDirect(env, async (sql) => {
    await sql.unsafe(META_DDL)
    for (const c of model.collections) {
      const table = tableName(c.name)
      await sql.unsafe(collectionDdl(table))
      const [{ n }] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`)
      if (n === 0 && c.seed.length) {
        const stamp = Date.now()
        for (const [i, r] of c.seed.entries()) {
          const { id, createdAt, updatedAt: _u, ...data } = r as Record<string, unknown>
          const created = typeof createdAt === "string" ? createdAt : new Date(stamp - i * 3_600_000).toISOString()
          await sql.unsafe(`insert into ${table} (id, data, created_at) values ($1, $2::jsonb, $3) on conflict (id) do nothing`, [
            String(id ?? randomUUID()),
            JSON.stringify(data),
            created,
          ])
        }
      }
    }
    for (const [key, value] of Object.entries(model.settings)) {
      await sql`insert into app_settings (key, value) values (${key}, ${sql.json(value as postgres.JSONValue)}) on conflict (key) do nothing`
    }
  })
}

type Row = { id: string; data: Record<string, unknown>; created_at: Date; updated_at: Date | null }
const toRecord = (r: Row) => ({
  ...r.data,
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  ...(r.updated_at ? { updatedAt: new Date(r.updated_at).toISOString() } : {}),
})

const clean = (values: Record<string, unknown>) => {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = values ?? {}
  const json = JSON.stringify(rest)
  if (json.length > 256_000) throw new AppBackendError("That item is too large to save.")
  return json
}

const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01"

async function bump(sql: postgres.Sql) {
  await sql`update app_meta set value = value + 1 where key = 'version'`
}

const newId = () => `r${Date.now().toString(36)}${randomUUID().slice(0, 8)}`

export function dataApi(projectId: string, env: AppEnv) {
  const sql = appSql(projectId, env)
  // A collection the screens use that isn't in the data model yet: create it on first write.
  const ensure = (table: string) => sql.unsafe(collectionDdl(table))

  return {
    async list(collection: string) {
      const table = tableName(collection)
      try {
        const rows = await sql.unsafe<Row[]>(`select id, data, created_at, updated_at from ${table} order by created_at desc limit 1000`)
        return rows.map(toRecord)
      } catch (e) {
        if (missingTable(e)) return []
        throw e
      }
    },
    async get(collection: string, id: string) {
      const table = tableName(collection)
      try {
        const [row] = await sql.unsafe<Row[]>(`select id, data, created_at, updated_at from ${table} where id = $1`, [id])
        return row ? toRecord(row) : null
      } catch (e) {
        if (missingTable(e)) return null
        throw e
      }
    },
    async insert(collection: string, values: Record<string, unknown>) {
      const table = tableName(collection)
      const data = clean(values)
      const run = () =>
        sql.unsafe<Row[]>(`insert into ${table} (id, data) values ($1, $2::jsonb) returning id, data, created_at, updated_at`, [newId(), data])
      let rows: Row[]
      try {
        rows = await run()
      } catch (e) {
        if (!missingTable(e)) throw e
        await ensure(table)
        rows = await run()
      }
      await bump(sql)
      return toRecord(rows[0])
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      const table = tableName(collection)
      const rows = await sql
        .unsafe<Row[]>(
          `update ${table} set data = data || $2::jsonb, updated_at = now() where id = $1 returning id, data, created_at, updated_at`,
          [id, clean(patch)]
        )
        .catch((e) => (missingTable(e) ? [] : Promise.reject(e)))
      if (!rows.length) throw new AppBackendError("That item no longer exists.", 404)
      await bump(sql)
      return toRecord(rows[0])
    },
    async remove(collection: string, id: string) {
      const table = tableName(collection)
      await sql.unsafe(`delete from ${table} where id = $1`, [id]).catch((e) => (missingTable(e) ? [] : Promise.reject(e)))
      await bump(sql)
    },
    async settings() {
      const rows = await sql<{ key: string; value: unknown }[]>`select key, value from app_settings`.catch((e) =>
        missingTable(e) ? [] : Promise.reject(e)
      )
      return Object.fromEntries(rows.map((r) => [r.key, r.value]))
    },
    async setSetting(key: string, value: unknown) {
      if (!/^[\w.:-]{1,80}$/.test(key)) throw new AppBackendError("Invalid setting name.")
      await sql`insert into app_settings (key, value, updated_at) values (${key}, ${sql.json((value ?? null) as postgres.JSONValue)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()`
      await bump(sql)
    },
    async version() {
      const [row] = await sql<{ value: string }[]>`select value from app_meta where key = 'version'`.catch(() => [])
      return Number(row?.value ?? 0)
    },
  }
}

// ---------------------------------------------------------------- storage

function s3(env: AppEnv) {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    throw new AppBackendError("The app's CloudHike storage isn't ready.", 409)
  return {
    bucket: env.S3_BUCKET,
    client: new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || "auto",
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    }),
  }
}

const MAX_UPLOAD = 8 * 1024 * 1024
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "application/pdf": "pdf" }

/** Stores a picked file in the app's bucket. Returns a stable URL served (signed) through this server. */
export async function uploadFile(projectId: string, env: AppEnv, dataUrl: string) {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new AppBackendError("That file couldn't be read.")
  const type = m[1].toLowerCase()
  const ext = TYPES[type]
  if (!ext) throw new AppBackendError("That file type isn't supported.")
  const body = Buffer.from(m[2], "base64")
  if (body.length > MAX_UPLOAD) throw new AppBackendError("That file is too large (8 MB max).")
  const key = `uploads/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`
  const { client, bucket } = s3(env)
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }))
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  return { url: `${base}/api/app-files/${encodeURIComponent(projectId)}/${key}` }
}

const FILE_KEY = /^uploads\/\d{4}-\d{2}\/[0-9a-f-]{36}\.([a-z]{2,5})$/

/** The bytes of a stored file, for serving from our origin. */
export async function readFile(env: AppEnv, key: string) {
  const m = FILE_KEY.exec(key)
  if (!m) throw new AppBackendError("Not found.", 404)
  const { client, bucket } = s3(env)
  const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch((e) => {
    if ((e as { name?: string })?.name === "NoSuchKey") throw new AppBackendError("Not found.", 404)
    throw e
  })
  const type = Object.entries(TYPES).find(([, ext]) => ext === m[1])?.[0] ?? "application/octet-stream"
  return { body: await obj.Body!.transformToByteArray(), type }
}

/** A short-lived direct link (for downloads outside the preview). */
export async function signedFileUrl(env: AppEnv, key: string) {
  if (!FILE_KEY.test(key)) throw new AppBackendError("Not found.", 404)
  const { client, bucket } = s3(env)
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 })
}

// ---------------------------------------------------------------- auth (the app's own end users)

export type AppUser = { id: string; name: string; email: string; avatar?: string }

async function authCall<T>(env: AppEnv, path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  if (!env.AUTH_URL || !env.AUTH_PUBLISHABLE_KEY) throw new AppBackendError("The app's CloudHike Auth isn't ready.", 409)
  const headers: Record<string, string> = { "x-api-key": env.AUTH_PUBLISHABLE_KEY }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  if (init.token) headers.authorization = `Bearer ${init.token}`
  let res: Response
  try {
    res = await fetch(`${env.AUTH_URL.replace(/\/+$/, "")}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AppBackendError("Couldn't reach the sign-in service. Try again.", 503)
  }
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null
  if (!res.ok) {
    if (res.status === 503) throw new AppBackendError("The app's backend is waking up. Try again in a moment.", 503)
    throw new AppBackendError(res.status < 500 && data?.message ? data.message : "Something went wrong. Try again.", res.status < 500 ? res.status : 502)
  }
  return data as T
}

const toUser = (u: { id: string; name?: string | null; email: string; image?: string | null }): AppUser => ({
  id: u.id,
  name: u.name || u.email.split("@")[0],
  email: u.email,
  ...(u.image ? { avatar: u.image } : {}),
})

export function authApi(env: AppEnv) {
  type AuthRes = { token: string; user: { id: string; name?: string; email: string; image?: string } }
  return {
    async signUp(input: { name?: string; email: string; password: string }) {
      if (String(input.password ?? "").length < 8) throw new AppBackendError("Use at least 8 characters for the password.")
      const r = await authCall<AuthRes>(env, "/sign-up/email", {
        method: "POST",
        body: { name: input.name?.trim() || input.email.split("@")[0], email: input.email, password: input.password },
      })
      return { token: r.token, user: toUser(r.user) }
    },
    async signIn(input: { email: string; password: string }) {
      const r = await authCall<AuthRes>(env, "/sign-in/email", { method: "POST", body: { email: input.email, password: input.password } })
      return { token: r.token, user: toUser(r.user) }
    },
    async current(token: string) {
      if (!token) return null
      const r = await authCall<{ user?: AuthRes["user"] } | null>(env, "/get-session", { token }).catch((e) => {
        if (e instanceof AppBackendError && e.status === 401) return null
        throw e
      })
      return r?.user ? toUser(r.user) : null
    },
    async signOut(token: string) {
      if (token) await authCall(env, "/sign-out", { method: "POST", body: {}, token }).catch(() => {})
    },
    async resetPassword(email: string) {
      const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
      await authCall(env, "/request-password-reset", { method: "POST", body: { email, redirectTo: `${base}/` } })
    },
  }
}
