import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { POC_ROOT, type Workspace } from "../core/workspace"

/** Writes the current app to .data/app/ so it can be opened in the editor. */
export function exportHead(ws: Workspace) {
  const dir = path.join(POC_ROOT, ".data", "app")
  rmSync(dir, { recursive: true, force: true })
  for (const [p, content] of [["manifest.json", JSON.stringify(ws.manifest, null, 2) + "\n"] as const, ...Object.entries(ws.files)]) {
    const full = path.join(dir, p)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
