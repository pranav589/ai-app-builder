// Free photo lookup used to fill blank seed "image" fields, so a fresh build
// is populated with real-looking content instead of relying on the UI's
// tasteful-placeholder fallback. Backed by https://picsum.photos: no API
// key, no documented rate limit, and no per-provider outage to juggle.
// Picsum has no keyword search — it's random stock photos by seed — so
// results aren't category-relevant, but they're always available.

/** djb2 — deterministic, non-cryptographic; just needs to spread strings into stable ints for a seed. */
function hashSeed(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return h >>> 0
}

/**
 * Random-but-stable Picsum photo for `query`+`variation`, so the same query
 * always maps to the same photo but a collection of near-identical seed rows
 * (e.g. many products in one category) doesn't end up with the exact same
 * photo repeated across every row.
 */
function picsumUrl(query: string, variation: number): string {
  const seed = hashSeed(`${query}#${variation}`)
  return `https://picsum.photos/seed/${seed}/1024/1024`
}

/**
 * Finds a free stock photo for `query`. Picsum's /seed/.../w/h URL shape is a
 * stable redirect to a real photo for any seed, so this just returns it —
 * no liveness check (Picsum's endpoint 405s on HEAD, which previously made
 * every lookup fail). Returns null only for an empty query.
 */
export async function findStockImage(query: string, variation = 0): Promise<string | null> {
  const trimmed = query.trim()
  if (!trimmed) return null
  return picsumUrl(trimmed, variation)
}
