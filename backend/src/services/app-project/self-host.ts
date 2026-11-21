import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { FileMap } from "@app/shared/verify/types"

// The "own it" half of a ZIP/GitHub export of an app connected to CloudHike: a
// small Node server (server/) that holds the CloudHike credentials from its
// own .env and answers the same calls the hosted route does. Its data logic is
// not rewritten here: the files below are copied from the builder's own
// source, so the exported server can't drift from what the preview runs.

/** [source in this repo, path in the export]. */
const COPIED: [string, string][] = [
  ["src/services/cloudhike/app-data.ts", "server/app-data.ts"],
  ["src/services/cloudhike/app-ops.ts", "server/app-ops.ts"],
  ["../shared/app-runtime/data-model-types.ts", "server/data-model-types.ts"],
]

// The only import a copied file has that doesn't resolve next to it.
const TYPES_IMPORT = '"@app/shared/app-runtime/data-model-types"'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function readSource(rel: string): string {
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), "backend", rel),
    path.resolve(HERE, "../../..", rel),
    path.resolve(HERE, "../..", rel),
    path.resolve(HERE, "..", rel),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const text = fs.readFileSync(c, "utf8")
      return text.replaceAll(TYPES_IMPORT, '"./data-model-types"')
    }
  }
  const text = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8")
  return text.replaceAll(TYPES_IMPORT, '"./data-model-types"')
}

const SERVER_INDEX = String.raw`// This app's backend, for running it yourself. It holds your CloudHike
// credentials (from .env) and answers the data, sign-in and file calls the app
// makes, so no secret ever ships inside the app. See the README.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFileSync } from "node:fs"
import { timingSafeEqual } from "node:crypto"
import path from "node:path"
import { AppBackendError, readFile, syncSchema, type AppEnv } from "./app-data"
import { appOpFailure, runAppOp } from "./app-ops"
import type { DataModel } from "./data-model-types"

const PORT = Number(process.env.PORT || 3001)
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:" + PORT).replace(/\/+$/, "")
const APP_KEY = process.env.APP_KEY || ""
const MAX_BODY = 12 * 1024 * 1024

const ENV_KEYS = ["DATABASE_URL", "DIRECT_URL", "AUTH_URL", "AUTH_PUBLISHABLE_KEY", "S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]
const env: AppEnv = {}
for (const k of ENV_KEYS) if (process.env[k]) env[k] = process.env[k]!

if (!env.DATABASE_URL) fail("DATABASE_URL is not set. Copy .env.example to .env and fill it in (see the README).")
if (APP_KEY.length < 16) fail("APP_KEY must be a long random string (16+ characters). See .env.example.")

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

// The data model the app was generated with: collections (data/schema.json) and their sample records (data/seed.json).
const readData = (file: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "data", file), "utf8"))
const schema = readData("schema.json") as Omit<DataModel["collections"][number], "seed">[]
const seed = readData("seed.json") as { hash: string; collections: Record<string, Record<string, unknown>[]>; settings: Record<string, unknown>; user: DataModel["user"] }
const model: DataModel = { hash: seed.hash, settings: seed.settings, user: seed.user, collections: schema.map((c) => ({ ...c, seed: seed.collections[c.name] ?? [] })) }

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-app-key, x-app-session",
  "access-control-allow-methods": "GET, POST, OPTIONS",
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...CORS, "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) req.destroy()
      else chunks.push(c)
    })
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        resolve(parsed && typeof parsed === "object" ? parsed : null)
      } catch {
        resolve(null)
      }
    })
    req.on("error", () => resolve(null))
  })
}

const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

async function serveFile(res: ServerResponse, key: string) {
  try {
    const file = await readFile(env, key)
    res.writeHead(200, { ...CORS, "content-type": file.type, "cache-control": "private, max-age=86400, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" })
    res.end(Buffer.from(file.body))
  } catch (e) {
    send(res, e instanceof AppBackendError && e.status === 404 ? 404 : 503, { error: "Not found." })
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", PUBLIC_URL)
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS)
    return res.end()
  }
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true })
  if (req.method === "GET" && url.pathname.startsWith("/files/")) return serveFile(res, decodeURIComponent(url.pathname.slice("/files/".length)))
  if (req.method !== "POST" || url.pathname !== "/data") return send(res, 404, { error: "Not found." })
  if (!sameKey(String(req.headers["x-app-key"] || ""), APP_KEY)) return send(res, 403, { error: "Wrong app key. EXPO_PUBLIC_APP_KEY must match APP_KEY in server/.env." })

  const body = await readBody(req)
  try {
    const result = await runAppOp(
      {
        projectId: "app",
        env,
        model,
        session: String(req.headers["x-app-session"] || ""),
        fileUrl: (key) => PUBLIC_URL + "/files/" + key,
        resetRedirect: PUBLIC_URL + "/",
        declaredOnly: true,
      },
      body
    )
    send(res, 200, { result })
  } catch (e) {
    const failure = appOpFailure(e, String(body?.op))
    send(res, failure.status, { error: failure.error })
  }
})

// Creates the tables for your data model and fills the empty ones with sample data. Safe to run on every start.
syncSchema(env, model)
  .then(() => console.log("Database tables are ready."))
  .catch((e) => console.error("Couldn't set up the database tables (the server is still starting):", e instanceof Error ? e.message : e))

server.listen(PORT, () => console.log("Backend listening on " + PUBLIC_URL + " (POST /data)"))
`

const SERVER_PACKAGE_JSON =
  JSON.stringify(
    {
      name: "app-backend",
      version: "1.0.0",
      private: true,
      scripts: { dev: "tsx --env-file=.env index.ts", start: "tsx index.ts" },
      engines: { node: ">=20.6" },
      dependencies: { "@aws-sdk/client-s3": "^3.1169.0", postgres: "^3.4.5", tsx: "^4.19.0" },
      devDependencies: { "@types/node": "^22.0.0" },
    },
    null,
    2
  ) + "\n"

const SERVER_ENV_EXAMPLE = `# Copy this file to server/.env and fill it in. Never commit .env.

PORT=3001
# The address the app reaches this server at, used in the URLs of uploaded files.
# Locally use your computer's network IP (not localhost) so a phone can reach it;
# once deployed, use the public https URL.
PUBLIC_URL=http://localhost:3001

# Any long random string (16+ characters), e.g. the output of: openssl rand -base64 24
# The app sends it with every call; put the same value in EXPO_PUBLIC_APP_KEY.
APP_KEY=replace-with-a-long-random-string

# From your CloudHike project's environment (CloudHike dashboard -> your project -> Environment).
DATABASE_URL=postgresql://user:password@host:6543/postgres
DIRECT_URL=postgresql://user:password@host:5432/postgres
AUTH_URL=https://your-auth-url
AUTH_PUBLISHABLE_KEY=your-auth-publishable-key
S3_ENDPOINT=https://your-storage-endpoint
S3_BUCKET=your-bucket
S3_REGION=auto
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
`

const APP_ENV_EXAMPLE = `# Copy this file to .env to make the app use your own server (see README, Option B).
# Anything starting with EXPO_PUBLIC_ is bundled into the app: never put a secret here.
# Leave both lines commented out to keep using the backend the app was exported with.

# EXPO_PUBLIC_API_URL=http://192.168.1.20:3001/data
# EXPO_PUBLIC_APP_KEY=same-value-as-APP_KEY-in-server/.env
`

/** The self-host server, its .env templates, and the app-side .env template. */
export function selfHostFiles(): FileMap {
  const files: FileMap = {
    "server/index.ts": SERVER_INDEX,
    "server/package.json": SERVER_PACKAGE_JSON,
    "server/.env.example": SERVER_ENV_EXAMPLE,
    ".env.example": APP_ENV_EXAMPLE,
  }
  for (const [from, to] of COPIED) files[to] = readSource(from)
  return files
}

/** The app's tsconfig globs every .ts file; the Node server isn't part of the app's type-check. */
export function excludeServerFromTsconfig(tsconfig: string | undefined): string | undefined {
  if (!tsconfig) return tsconfig
  try {
    return JSON.stringify({ ...JSON.parse(tsconfig), exclude: ["server", "node_modules"] }, null, 2) + "\n"
  } catch {
    return tsconfig
  }
}
