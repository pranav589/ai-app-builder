// Dev-only: flips one project's engine so it can be tested on the verified
// pipeline without changing DEFAULT_ENGINE for everyone.
// Usage: node --env-file=.env scripts/set-engine.mjs <projectId> <legacy|verified>
import postgres from "postgres"

const [projectId, engine] = process.argv.slice(2)
if (!projectId || !["legacy", "verified"].includes(engine)) {
  console.error("Usage: node --env-file=.env scripts/set-engine.mjs <projectId> <legacy|verified>")
  process.exit(1)
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL")
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} })
try {
  const rows = await sql`update projects set engine = ${engine} where id = ${projectId} returning id, engine`
  if (!rows.length) {
    console.error(`No project with id ${projectId}`)
    process.exit(1)
  }
  console.log(`${rows[0].id} -> ${rows[0].engine}`)
} finally {
  await sql.end({ timeout: 5 })
}
