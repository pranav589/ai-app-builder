// Phase 11: gives every project still missing a manifest its first one, so
// nothing is left relying on the lazy in-memory fallback (lib/manifest/migrate.ts
// ensureManifest) the next time it happens to be opened or edited. No AI calls:
// the manifest is built deterministically from the project's latest plan and
// app document (fromLegacy), then compiled into real navigation/data files
// exactly as a normal build would. Existing screens and platform files are
// left untouched; only the manifest, the compiler's own files, and the
// platform kit module are added or refreshed.
//
// Safe to run more than once: a project that already has a manifest is
// skipped. Pass --dry-run to see what would happen without writing anything.
//
// Usage: npm run migrate-to-verified -- [--dry-run]
import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import type { AppPlan } from "@app/shared/agent/types"
import { ensureManifest } from "@app/shared/manifest/migrate"
import { compileManifest } from "@app/shared/manifest/compile"
import { KIT_PATH, KIT_SOURCE } from "@/lib/app-project/kit"
import { commitSnapshot } from "@/lib/versions/store"
import { latestPlan } from "@/lib/agent/orchestrator"

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  const rows = await db.select({ id: projects.id, name: projects.name, previewScreens: projects.previewScreens, engine: projects.engine }).from(projects)
  console.log(`${rows.length} project(s) found${dryRun ? " (dry run, nothing will be written)" : ""}\n`)

  let migrated = 0
  let skippedAlready = 0
  let skippedNoPlan = 0

  for (const row of rows) {
    const doc = readAppDoc(row.previewScreens)
    if (doc.manifest) {
      skippedAlready++
      continue
    }

    try {
      const plan: AppPlan | null = await latestPlan(row.id)
      const manifest = ensureManifest(doc, plan)
      if (!manifest) {
        console.log(`- ${row.id} (${row.name}): no plan in chat history, nothing to build a manifest from -- skipped`)
        skippedNoPlan++
        continue
      }

      const generated = compileManifest(manifest, { connected: doc.backend.provider !== "local" })
      console.log(`- ${row.id} (${row.name}): migrating -- ${Object.keys(manifest.screens).length} screen(s) in the manifest, ${Object.keys(generated).length} generated file(s)`)
      migrated++
      if (dryRun) continue

      const files = { ...(doc.files ?? {}), ...generated, [KIT_PATH]: KIT_SOURCE }
      await commitSnapshot(row.id, { ...doc, files, manifest }, { intent: "Migrated to the verified engine" })
      if (row.engine !== "verified") await db.update(projects).set({ engine: "verified" }).where(eq(projects.id, row.id))
    } catch (e) {
      console.error(`- ${row.id} (${row.name}): FAILED -- ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(`\n${migrated} migrated, ${skippedAlready} already had a manifest, ${skippedNoPlan} had no plan to migrate from.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
