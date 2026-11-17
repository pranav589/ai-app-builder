import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { Snapshot } from "../core/types"
import { POC_ROOT, type Workspace } from "../core/workspace"
import { validateManifest } from "../core/manifest"

// Content-addressed snapshots on disk (stand-in for Postgres + S3).
// Committing writes new blobs and a snapshot, then moves HEAD. Nothing else
// changes HEAD, so a rejected change leaves the app exactly as it was.

const DATA = path.join(POC_ROOT, ".data")
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

function ensure() {
  for (const d of ["blobs", "snapshots", "runs"]) mkdirSync(path.join(DATA, d), { recursive: true })
}

export function head(): string | null {
  const f = path.join(DATA, "HEAD")
  return existsSync(f) ? readFileSync(f, "utf8").trim() || null : null
}

export function setHead(id: string) {
  ensure()
  writeFileSync(path.join(DATA, "HEAD"), id + "\n")
}

export function commit(ws: Workspace, meta: { author: Snapshot["author"]; intent: string }): Snapshot {
  ensure()
  const tree: Record<string, string> = {}
  const entries: [string, string][] = [["manifest.json", JSON.stringify(ws.manifest, null, 2) + "\n"], ...Object.entries(ws.files)]
  for (const [p, content] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
    const h = sha(content)
    const blob = path.join(DATA, "blobs", h)
    if (!existsSync(blob)) writeFileSync(blob, content)
    tree[p] = h
  }
  const parent = head()
  const id = sha(JSON.stringify({ parent, tree })).slice(0, 12)
  const snap: Snapshot = { id, parent, createdAt: new Date().toISOString(), author: meta.author, intent: meta.intent, tree }
  writeFileSync(path.join(DATA, "snapshots", `${id}.json`), JSON.stringify(snap, null, 2))
  setHead(id)
  return snap
}

export function readSnapshot(id: string): Snapshot {
  return JSON.parse(readFileSync(path.join(DATA, "snapshots", `${id}.json`), "utf8"))
}

export function checkout(id: string): Workspace {
  const snap = readSnapshot(id)
  const read = (h: string) => readFileSync(path.join(DATA, "blobs", h), "utf8")
  const { manifest } = validateManifest(JSON.parse(read(snap.tree["manifest.json"])))
  if (!manifest) throw new Error(`snapshot ${id} has an invalid manifest`)
  const files = Object.fromEntries(Object.entries(snap.tree).filter(([p]) => p !== "manifest.json").map(([p, h]) => [p, read(h)]))
  return { manifest, files }
}

export function history(): Snapshot[] {
  const out: Snapshot[] = []
  for (let id = head(); id; id = readSnapshot(id).parent) out.push(readSnapshot(id))
  return out
}

export function saveRunLog(name: string, data: unknown) {
  ensure()
  const file = path.join(DATA, "runs", `${name}.json`)
  writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}
