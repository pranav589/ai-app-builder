// Exports a project's current plan and app document as an eval fixture.
// Usage: npm run export-fixture -- --project <id> --name <fixture>
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { desc, eq } from "drizzle-orm"

import { db, messages, projects } from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import type { AppPlan } from "@app/shared/agent/types"

async function main() {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const projectId = arg("--project")
  const name = arg("--name")
  if (!projectId || !name) {
    console.error("Usage: npm run export-fixture -- --project <id> --name <fixture>")
    process.exit(1)
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw new Error(`No project ${projectId}`)

  const [planRow] = await db
    .select({ plan: messages.plan })
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(desc(messages.createdAt))
    .limit(200)
    .then((rows) => rows.filter((r) => r.plan))
  const plan = planRow?.plan as AppPlan | undefined
  if (!plan) throw new Error(`No plan found in ${projectId}'s chat history`)

  const doc = readAppDoc(project.previewScreens)

  const dir = path.join(process.cwd(), "eval", "fixtures")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify({ plan, doc }, null, 2) + "\n")

  console.log(`Wrote ${file} (${project.name}: ${doc.screens.length} screens, ${Object.keys(doc.files ?? {}).length} other files)`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
