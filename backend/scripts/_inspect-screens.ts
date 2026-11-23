import { db, projects } from "@/db"
import { eq } from "drizzle-orm"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"

async function main() {
  const projectId = process.argv[2]
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) {
    console.log("not found")
    process.exit(1)
  }
  const doc = readAppDoc(project.previewScreens)
  for (const s of doc.screens) {
    if (!s.code) continue
    const matches = [...s.code.matchAll(/api\.(get|post|patch|put|delete)\(/g)].map((m) => m[1])
    if (matches.length) console.log(s.path, matches)
  }
  console.log("lib/api.ts calls:", [...((doc.files?.["lib/api.ts"] ?? "").matchAll(/api\.(get|post|patch|put|delete):/g))].map((m) => m[1]))
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
