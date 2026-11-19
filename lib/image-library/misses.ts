import "server-only"
import { sql } from "drizzle-orm"
import { db, imageLibraryMisses } from "@/db"

/**
 * Records an image search query that returned no suitable library match.
 * Normalizes query string and upserts on conflict, bumping hit_count and updating last_seen_at.
 * Never throws — logging misses must never break an agent build.
 */
export async function recordMiss(
  query: string,
  collectionLabel?: string,
  subject?: string
): Promise<void> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return

  try {
    const id = `miss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await db
      .insert(imageLibraryMisses)
      .values({
        id,
        query: normalized,
        collectionLabel: collectionLabel?.trim() || null,
        subject: subject?.trim() || null,
        hitCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: imageLibraryMisses.query,
        set: {
          hitCount: sql`${imageLibraryMisses.hitCount} + 1`,
          lastSeenAt: new Date(),
          ...(collectionLabel?.trim() ? { collectionLabel: collectionLabel.trim() } : {}),
          ...(subject?.trim() ? { subject: subject.trim() } : {}),
        },
      })
  } catch (e) {
    console.warn("Failed to record image library miss:", e instanceof Error ? e.message : e)
  }
}
