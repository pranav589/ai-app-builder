// Targeted edits to generated files. Instead of rewriting a whole file for a
// small change ("add a scroll"), the editor model returns only the changed
// lines as search/replace blocks:
//
//   <edit path="app/(tabs)/home.tsx">
//   <<<<<<< SEARCH
//   exact existing lines
//   =======
//   replacement lines
//   >>>>>>> REPLACE
//   </edit>
//
// or, when a file changes a lot, the whole new file in <file path="...">.
// Output is a fraction of a full rewrite, so edits are much faster.

export type FileEdit =
  | { path: string; kind: "patch"; hunks: { search: string; replace: string }[] }
  | { path: string; kind: "file"; code: string }

const cleanPath = (p: string) => p.trim().replace(/^\.?\//, "")

/** Parses the editor's reply into per-file edits. */
export function parseEdits(raw: string): FileEdit[] {
  const out: FileEdit[] = []
  for (const m of raw.matchAll(/<edit\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/edit>/g)) {
    const hunks: { search: string; replace: string }[] = []
    for (const h of m[2].matchAll(/<{5,9}\s*SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\n]*\n([\s\S]*?)\n?>{5,9}\s*REPLACE/g)) {
      hunks.push({ search: h[1], replace: h[2] })
    }
    if (hunks.length) out.push({ path: cleanPath(m[1]), kind: "patch", hunks })
  }
  for (const m of raw.matchAll(/<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g)) {
    let code = m[2].trim()
    const fenced = /^```\w*\s*\n([\s\S]*?)\n?```$/.exec(code)
    if (fenced) code = fenced[1]
    out.push({ path: cleanPath(m[1]), kind: "file", code: code + "\n" })
  }
  return out
}

/** Finds `search` in `code`: exactly, then ignoring trailing whitespace, then ignoring indentation. */
function locate(code: string, search: string): { start: number; end: number } | null {
  if (!search.trim()) return null
  const s = search.replace(/\n+$/, "")
  const exact = code.indexOf(s)
  if (exact !== -1 && code.indexOf(s, exact + 1) === -1) return { start: exact, end: exact + s.length }

  const lines = code.split("\n")
  const want = search.replace(/\n+$/, "").split("\n")
  for (const norm of [(s: string) => s.trimEnd(), (s: string) => s.trim()]) {
    const target = want.map(norm)
    // Skip leading/trailing blank lines of the search block when matching loosely.
    while (target.length && !target[0]) target.shift()
    while (target.length && !target[target.length - 1]) target.pop()
    if (!target.length) continue
    const hits: number[] = []
    for (let i = 0; i + target.length <= lines.length; i++) {
      let ok = true
      for (let j = 0; j < target.length && ok; j++) ok = norm(lines[i + j]) === target[j]
      if (ok) hits.push(i)
    }
    if (hits.length === 1) {
      const startLine = hits[0]
      const start = lines.slice(0, startLine).join("\n").length + (startLine ? 1 : 0)
      const end = start + lines.slice(startLine, startLine + target.length).join("\n").length
      return { start, end }
    }
  }
  return null
}

/** Applies search/replace hunks in order. Returns the new code and the hunks that didn't match. */
export function applyHunks(code: string, hunks: { search: string; replace: string }[]) {
  let out = code
  const failed: { search: string; replace: string }[] = []
  for (const h of hunks) {
    const at = locate(out, h.search)
    if (!at) {
      failed.push(h)
      continue
    }
    out = out.slice(0, at.start) + h.replace.replace(/\n+$/, "") + out.slice(at.end)
  }
  return { code: out, failed }
}
