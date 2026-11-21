import { randomUUID } from "node:crypto"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import postgres from "postgres"

import type { DataField, DataModel, FieldType } from "@app/shared/app-runtime/data-model-types"

// The data plane of a generated app on CloudHike. CloudHike has no client
// data API (its database is reached with a connection string), so the app
// talks to this server, which holds the project's credentials and talks to
// its Database, Storage and Auth. Credentials never reach the browser or the AI.
//
// Layout in the app's database:
//   app_c_<collection>  one table per collection: id, created_at, updated_at, one real
//                        column per field the data model declares (text/numeric/boolean/
//                        timestamptz), plus an `extra` jsonb catch-all for anything a
//                        screen writes that isn't declared (keeps ad-hoc collections and
//                        fields working without a migration).
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

/** Field type -> the real Postgres column type it's given. */
const PG_TYPE: Record<FieldType, string> = {
  string: "text",
  text: "text",
  number: "numeric",
  boolean: "boolean",
  date: "timestamptz",
  image: "text",
  enum: "text",
}

// These names are the record's own fixed columns (or the catch-all); a data
// model field with one of these names would collide with them, so it's left
// out of the typed columns and falls back to living in `extra` instead.
const RESERVED_FIELD_NAMES = new Set(["id", "createdAt", "updatedAt", "extra"])
const COLUMN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/

type EffectiveField = { name: string; column: string; type: FieldType }

/**
 * The data model's fields for one collection, as real (quoted, validated)
 * column names. A field whose name can't be made a safe identifier, or that
 * collides with a reserved column or another field once sanitized, is
 * dropped here (its value still round-trips, just through `extra`) rather
 * than failing the whole sync over one bad field.
 */
function effectiveFields(fields: DataField[]): EffectiveField[] {
  const out: EffectiveField[] = []
  const seen = new Set<string>()
  for (const f of fields) {
    if (RESERVED_FIELD_NAMES.has(f.name)) continue
    const column = f.name.replace(/-/g, "_")
    if (!COLUMN.test(column) || seen.has(column)) continue
    seen.add(column)
    out.push({ name: f.name, column, type: f.type })
  }
  return out
}

const baseDdl = (table: string) => `
create table if not exists ${table} (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  extra jsonb not null default '{}'::jsonb
);
create index if not exists ${table}_created_idx on ${table} (created_at desc);`

const columnDdl = (table: string, f: EffectiveField) => `alter table ${table} add column if not exists "${f.column}" ${PG_TYPE[f.type]};`

/**
 * A table from before fields had their own columns (everything lived in one
 * `data` jsonb blob): renames that column to `extra` (the same role, new
 * name) and backfills each declared field's new column from it. Idempotent
 * either way — a table that never had a `data` column, or was already
 * migrated, just runs the (then-empty) backfill updates as a no-op.
 */
const migrateLegacyDdl = (table: string, fields: EffectiveField[]) => {
  const rename = `
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = '${table}' and column_name = 'data')
     and not exists (select 1 from information_schema.columns where table_name = '${table}' and column_name = 'extra') then
    alter table ${table} rename column data to extra;
  end if;
end $$;`
  const casts: Record<FieldType, string> = { string: "", text: "", number: "::numeric", boolean: "::boolean", date: "::timestamptz", image: "", enum: "" }
  const backfills = fields.map((f) => {
    const raw = `extra->>'${f.name}'`
    // A field left blank (e.g. no expiry date set) stored "" in the old blob; casting "" straight
    // to numeric/boolean/timestamptz errors, so an empty string becomes null instead, same as unset.
    const value = casts[f.type] ? `nullif(${raw}, '')${casts[f.type]}` : raw
    return `update ${table} set "${f.column}" = ${value} where "${f.column}" is null and extra ? '${f.name}';`
  })
  return [rename, ...backfills].join("\n")
}

/** Ensures a collection's table has every current field as a real column (new table or an older one). */
async function ensureTable(sql: postgres.Sql, table: string, fields: EffectiveField[]) {
  await sql.unsafe(baseDdl(table))
  for (const f of fields) await sql.unsafe(columnDdl(table, f))
  await sql.unsafe(migrateLegacyDdl(table, fields))
}

/**
 * Creates the tables for the app's data model (one real column per declared
 * field, migrating an older single-jsonb-column table in place) and seeds
 * collections that are still empty. Idempotent, and never deletes data: a
 * revised plan adds tables and columns, it doesn't drop the old ones.
 */
export async function syncSchema(env: AppEnv, model: DataModel) {
  await withDirect(env, async (sql) => {
    await sql.unsafe(META_DDL)
    for (const c of model.collections) {
      const table = tableName(c.name)
      const fields = effectiveFields(c.fields)
      await ensureTable(sql, table, fields)
      const [{ n }] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`)
      if (n === 0 && c.seed.length) {
        const stamp = Date.now()
        for (const [i, r] of c.seed.entries()) {
          const { id, createdAt, updatedAt: _u, ...rest } = r as Record<string, unknown>
          const created = typeof createdAt === "string" ? createdAt : new Date(stamp - i * 3_600_000).toISOString()
          const { columns, values, extra } = splitRecord(fields, rest)
          const cols = ["id", "created_at", ...columns.map((col) => `"${col}"`), "extra"]
          const placeholders = cols.map((_, idx) => (idx === cols.length - 1 ? `$${idx + 1}::jsonb` : `$${idx + 1}`))
          await sql.unsafe(`insert into ${table} (${cols.join(", ")}) values (${placeholders.join(", ")}) on conflict (id) do nothing`, [
            String(id ?? randomUUID()),
            created,
            ...values,
            sql.json(extra as postgres.JSONValue),
          ] as postgres.ParameterOrJSON<never>[])
        }
      }
    }
    for (const [key, value] of Object.entries(model.settings)) {
      await sql`insert into app_settings (key, value) values (${key}, ${sql.json(value as postgres.JSONValue)}) on conflict (key) do nothing`
    }
  })
}

/** A field's JS value as its column expects it. `undefined` (absent) becomes a plain null. */
function toColumnValue(type: FieldType, v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (type === "number") return typeof v === "number" ? v : Number(v)
  if (type === "boolean") return typeof v === "boolean" ? v : Boolean(v)
  return v
}

/** Splits a full record's values into its declared columns (in the model's order) plus anything left over, for an insert. */
function splitRecord(fields: EffectiveField[], values: Record<string, unknown>) {
  const columns: string[] = []
  const vals: unknown[] = []
  const used = new Set<string>()
  for (const f of fields) {
    used.add(f.name)
    columns.push(f.column)
    vals.push(toColumnValue(f.type, values[f.name]))
  }
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (!used.has(k)) extra[k] = v
  return { columns, values: vals, extra }
}

/** Same split, but for a partial patch: only the keys actually present move to their column (so an unset field is left alone, not nulled out). */
function splitPatch(fields: EffectiveField[], patch: Record<string, unknown>) {
  const sets: { column: string; value: unknown }[] = []
  const used = new Set<string>()
  for (const f of fields) {
    if (!(f.name in patch)) continue
    used.add(f.name)
    sets.push({ column: f.column, value: toColumnValue(f.type, patch[f.name]) })
  }
  const extraPatch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) if (!used.has(k)) extraPatch[k] = v
  return { sets, extraPatch }
}

/** A row (every real column, plus `extra`) back into the record shape a screen expects. */
function toRecord(row: Record<string, unknown>, fields: EffectiveField[]) {
  const out: Record<string, unknown> = { ...((row.extra as Record<string, unknown> | null) ?? {}) }
  for (const f of fields) {
    const v = row[f.column]
    out[f.name] = v === null || v === undefined ? null : f.type === "number" ? Number(v) : f.type === "date" ? new Date(v as string).toISOString() : v
  }
  out.id = row.id as string
  out.createdAt = new Date(row.created_at as string).toISOString()
  if (row.updated_at) out.updatedAt = new Date(row.updated_at as string).toISOString()
  return out
}

/**
 * The size limit applies to everything a write carries (id/timestamps
 * stripped, those are separate columns), whichever columns or `extra` it
 * ends up in.
 */
const clean = (values: Record<string, unknown>) => {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = values ?? {}
  if (JSON.stringify(rest).length > 256_000) throw new AppBackendError("That item is too large to save.")
  return rest
}

const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01"

async function bump(sql: postgres.Sql) {
  await sql`update app_meta set value = value + 1 where key = 'version'`
}

const newId = () => `r${Date.now().toString(36)}${randomUUID().slice(0, 8)}`

/** `model` is the project's current data model, so each collection's writes land in its declared columns. A collection it doesn't name (or no model at all) just keeps everything in `extra`. */
export function dataApi(projectId: string, env: AppEnv, model?: DataModel | null) {
  const sql = appSql(projectId, env)
  const fieldsOf = (collection: string) => effectiveFields(model?.collections.find((c) => c.name === collection)?.fields ?? [])

  return {
    async list(collection: string) {
      const table = tableName(collection)
      const fields = fieldsOf(collection)
      try {
        const rows = await sql.unsafe<Record<string, unknown>[]>(`select * from ${table} order by created_at desc limit 1000`)
        return rows.map((r) => toRecord(r, fields))
      } catch (e) {
        if (missingTable(e)) return []
        throw e
      }
    },
    async get(collection: string, id: string) {
      const table = tableName(collection)
      const fields = fieldsOf(collection)
      try {
        const [row] = await sql.unsafe<Record<string, unknown>[]>(`select * from ${table} where id = $1`, [id])
        return row ? toRecord(row, fields) : null
      } catch (e) {
        if (missingTable(e)) return null
        throw e
      }
    },
    async insert(collection: string, values: Record<string, unknown>) {
      const table = tableName(collection)
      const fields = fieldsOf(collection)
      const { columns, values: vals, extra } = splitRecord(fields, clean(values))
      const cols = ["id", ...columns.map((c) => `"${c}"`), "extra"]
      const placeholders = cols.map((_, i) => (i === cols.length - 1 ? `$${i + 1}::jsonb` : `$${i + 1}`))
      const run = () =>
        sql.unsafe<Record<string, unknown>[]>(`insert into ${table} (${cols.join(", ")}) values (${placeholders.join(", ")}) returning *`, [
          newId(),
          ...vals,
          sql.json(extra as postgres.JSONValue),
        ] as postgres.ParameterOrJSON<never>[])
      let rows: Record<string, unknown>[]
      try {
        rows = await run()
      } catch (e) {
        if (!missingTable(e)) throw e
        await ensureTable(sql, table, fields)
        rows = await run()
      }
      await bump(sql)
      return toRecord(rows[0], fields)
    },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      const table = tableName(collection)
      const fields = fieldsOf(collection)
      const { sets, extraPatch } = splitPatch(fields, clean(patch))
      const assigns = sets.map((s, i) => `"${s.column}" = $${i + 2}`)
      const params: postgres.ParameterOrJSON<never>[] = [id, ...sets.map((s) => s.value)] as postgres.ParameterOrJSON<never>[]
      if (Object.keys(extraPatch).length) {
        assigns.push(`extra = extra || $${params.length + 1}::jsonb`)
        params.push(sql.json(extraPatch as postgres.JSONValue))
      }
      assigns.push("updated_at = now()")
      const rows = await sql
        .unsafe<Record<string, unknown>[]>(`update ${table} set ${assigns.join(", ")} where id = $1 returning *`, params)
        .catch((e) => (missingTable(e) ? [] : Promise.reject(e)))
      if (!rows.length) throw new AppBackendError("That item no longer exists.", 404)
      await bump(sql)
      return toRecord(rows[0], fields)
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

/** Stores a picked file in the app's bucket. `fileUrl` maps the stored key to the URL this server serves it from. */
export async function uploadFile(env: AppEnv, dataUrl: string, fileUrl: (key: string) => string) {
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
  return { url: fileUrl(key) }
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

/** `resetRedirect` is where the emailed password-reset link lands. */
export function authApi(env: AppEnv, resetRedirect: string) {
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
      await authCall(env, "/request-password-reset", { method: "POST", body: { email, redirectTo: resetRedirect } })
    },
  }
}
