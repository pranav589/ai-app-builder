
// At most one repair attempt per (project, version, path), in memory with a
// TTL. The client already caps itself (use-agent.ts MAX_REPAIRS), but that
// only protects one browser tab; this stops a second tab, a second frame
// report or a retried request from looping the same file (fixes.txt #6).
// Both engines go through the same repair route, so this applies to both.

const TTL_MS = 30 * 60 * 1000

const tried = new Map<string, number>() // key -> expiry

const key = (projectId: string, version: number, path: string) => `${projectId}:${version}:${path}`

function prune() {
  const now = Date.now()
  for (const [k, exp] of tried) if (exp <= now) tried.delete(k)
}

/** Claims the one repair attempt for this (project, version, path). False means it was already tried. */
export function claimRepairAttempt(projectId: string, version: number, path: string): boolean {
  prune()
  const k = key(projectId, version, path)
  if (tried.has(k)) return false
  tried.set(k, Date.now() + TTL_MS)
  return true
}
