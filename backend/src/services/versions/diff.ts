// A small, dependency-free line diff for the "Changes" view (Phase 9): what
// changed between two versions' workspaces. Server and browser safe.

export type DiffLine = { type: "context" | "add" | "remove"; line: string }
export type FileStatus = "added" | "removed" | "modified"
export type FileDiff = { path: string; status: FileStatus; lines: DiffLine[] }

/**
 * Longest-common-subsequence line diff. O(n*m) time and space, which is fine
 * at the file sizes this app ever produces (the policy gate caps app files
 * at 300 lines; platform files are similar).
 */
export function diffLines(before: string, after: string): DiffLine[] {
  // "".split("\n") is [""], one phantom empty line; an absent/empty file has none.
  const a = before === "" ? [] : before.split("\n")
  const b = after === "" ? [] : after.split("\n")
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", line: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", line: a[i] })
      i++
    } else {
      out.push({ type: "add", line: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: "remove", line: a[i++] })
  while (j < m) out.push({ type: "add", line: b[j++] })
  return out
}

/** Only the lines around a change, like `git diff`'s unified context, so an unrelated 300-line file doesn't dump every unchanged line. */
export function withContext(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, idx) => {
    if (l.type === "context") return
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true
  })
  const out: DiffLine[] = []
  for (let idx = 0; idx < lines.length; idx++) {
    if (!keep[idx]) continue
    if (idx > 0 && !keep[idx - 1]) out.push({ type: "context", line: "…" })
    out.push(lines[idx])
  }
  return out
}

/** Every file that differs between two workspaces (screens' code plus every other project file), sorted by path. */
export function diffWorkspaces(before: Record<string, string>, after: Record<string, string>): FileDiff[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: FileDiff[] = []
  for (const path of [...paths].sort()) {
    const b = before[path]
    const a = after[path]
    if (b === a) continue
    const status: FileStatus = b === undefined ? "added" : a === undefined ? "removed" : "modified"
    out.push({ path, status, lines: withContext(diffLines(b ?? "", a ?? "")) })
  }
  return out
}
