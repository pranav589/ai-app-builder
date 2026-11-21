// Applies every db/sql/*.sql file (agent runs, app-backend tables). Each file is idempotent.
// Usage: npm run db:sql
import { readdirSync, readFileSync } from "node:fs"
import postgres from "postgres"

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL")
const dir = new URL("../db/sql/", import.meta.url)
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} })
try {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(readFileSync(new URL(file, dir), "utf8"))
    console.log(`applied ${file}`)
  }
} finally {
  await sql.end({ timeout: 5 })
}
