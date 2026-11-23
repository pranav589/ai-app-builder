// Pure version-numbering logic for lib/versions/store.ts, kept separate from
// the DB so it can be unit tested without a database.

/**
 * What to write for a new commit. Legacy projects (current_version still 0,
 * but with an existing doc already on the canvas) get that doc committed as
 * version 1 first, lazily, so history starts somewhere meaningful instead of
 * silently adopting whatever was already there.
 */
export function versionsToCommit(currentVersion: number, hasExistingDoc: boolean): { initial?: number; parent: number | null; next: number } {
  if (currentVersion === 0 && hasExistingDoc) return { initial: 1, parent: 1, next: 2 }
  return { parent: currentVersion || null, next: currentVersion + 1 }
}

/** Versions beyond the newest `keep`, to prune after a commit. */
export function selectPrune(versions: number[], keep = 50): number[] {
  return [...versions].sort((a, b) => b - a).slice(keep)
}
