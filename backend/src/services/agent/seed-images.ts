// Fills blank "image" seed fields with real photos, so a fresh build is
// populated with real-looking content instead of relying on the UI's
// tasteful-placeholder fallback. Tries the curated ImageKit library first
// (lib/image-library), hard-filtered to the collection's own `category` (the
// AI's own best-guess from IMAGE_LIBRARY_CATEGORIES, lib/agent/prompts.ts)
// when it has one, records misses for unmatched queries, and falls back to
// Picsum (lib/stock-images) so a field is never blank. Only ever fills
// blanks: an image a prior build or a manual edit already set is left untouched.
import { findLibraryImage, recordMiss } from "@/lib/image-library"
import { findStockImage } from "@/lib/stock-images"
import type { DataModel } from "@app/shared/app-runtime/data-model"
import type { LiveRun } from "./registry"

// Picsum has no documented rate limit, unlike the pollinations.ai generation
// this replaced (1 image per 45s per IP), so a few lookups can run side by
// side.
const CONCURRENCY = 4

/** The seed record's own distinguishing text, for a short search query ("Merino Crew Sweater", not "r1a2b3 Clothing"). */
function subjectFor(record: Record<string, unknown>, collectionLabel: string): string {
  for (const [key, v] of Object.entries(record)) {
    if (key === "id" || key === "image") continue
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return collectionLabel
}

/**
 * Looks up and fills one photo per blank "image" field across a data model's
 * seed records, in place of the AI's own "" placeholder convention.
 * Checks the curated image library first; on a miss, records the query and
 * falls back to free stock photos (Picsum). A record whose lookup fails or
 * comes up empty is logged and left blank; one bad record doesn't fail the build.
 */
export async function fillSeedImages(data: DataModel, run?: LiveRun): Promise<DataModel> {
  type Task = { ci: number; ri: number; field: string; query: string; subject: string; collectionLabel: string; category?: string }
  const tasks: Task[] = []
  data.collections.forEach((c, ci) => {
    const imageFields = c.fields.filter((f) => f.type === "image").map((f) => f.name)
    if (!imageFields.length) return
    c.seed.forEach((record, ri) => {
      for (const field of imageFields) {
        if (record[field]) continue
        const subject = subjectFor(record, c.label)
        tasks.push({
          ci,
          ri,
          field,
          query: `${subject} ${c.label}`.trim(),
          subject,
          collectionLabel: c.label,
          category: c.category,
        })
      }
    })
  })
  if (!tasks.length) return data

  const collections = data.collections.map((c) => ({ ...c, seed: c.seed.map((r) => ({ ...r })) }))
  const usedIds = new Set<string>()
  let done = 0
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      try {
        const match = await findLibraryImage(task.subject, task.collectionLabel, usedIds, task.category)
        let url = match?.url
        if (!url) {
          try {
            await recordMiss(task.query, task.collectionLabel, task.subject)
          } catch (e) {
            console.warn("recordMiss failed:", e instanceof Error ? e.message : e)
          }
          url = (await findStockImage(task.query, task.ri)) ?? undefined
        }
        if (url) collections[task.ci].seed[task.ri][task.field] = url
        else console.warn("seed image search found nothing, leaving blank:", task.query)
      } catch (e) {
        console.warn("seed image search failed, leaving blank:", task.query, e instanceof Error ? e.message : e)
      } finally {
        done++
        run?.emit({ type: "status", text: `Finding product photos (${done}/${tasks.length})` })
      }
    }
  })
  await Promise.all(workers)
  return { ...data, collections }
}
