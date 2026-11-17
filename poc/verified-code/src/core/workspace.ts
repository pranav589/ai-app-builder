import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { COMPILER_PATHS, compileManifest } from "../compiler/compile"
import { applyPatch, validateManifest, type AppManifest } from "./manifest"
import type { ChangeSet, Diagnostic, FileMap } from "./types"

export const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
export const SDK_DIR = path.join(POC_ROOT, "src/sdk")

/** Platform modules. Only "@app/kit" and "@app/theme" may be imported by app code. */
export const SDK_MODULES: Record<string, string> = {
  "@app/kit": path.join(SDK_DIR, "kit.tsx"),
  "@app/theme": path.join(SDK_DIR, "theme.tsx"),
  "@app/data-runtime": path.join(SDK_DIR, "data-runtime.tsx"),
  "@app/nav-runtime": path.join(SDK_DIR, "nav-runtime.tsx"),
  "@app/shell": path.join(SDK_DIR, "shell.tsx"),
}

export interface Workspace {
  manifest: AppManifest
  /** Every project file: app-owned files plus compiler output. */
  files: FileMap
}

/** Paths the AI (or the user) may write. Everything else is compiler- or platform-owned. */
export function isAppOwned(p: string) {
  return /^screens\/[a-z][A-Za-z0-9]*\.tsx$/.test(p) || /^components\/[\w/-]+\.tsx?$/.test(p) || /^lib\/[\w/-]+\.tsx?$/.test(p)
}

export const isCompilerOwned = (p: string) => COMPILER_PATHS.includes(p)

function readTree(dir: string, base = dir, out: FileMap = {}) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) readTree(full, base, out)
    else out[path.relative(base, full).split(path.sep).join("/")] = readFileSync(full, "utf8").replace(/\r\n/g, "\n")
  }
  return out
}

export function loadFixture(name = "base"): Workspace {
  const dir = path.join(POC_ROOT, "fixtures", name)
  const raw = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"))
  const { manifest, diagnostics } = validateManifest(raw)
  if (!manifest) throw new Error(`fixture manifest is invalid: ${diagnostics.map((d) => d.message).join("; ")}`)
  const files = readTree(dir)
  delete files["manifest.json"]
  return { manifest, files: { ...files, ...compileManifest(manifest) } }
}

export const appFiles = (ws: Workspace) => Object.fromEntries(Object.entries(ws.files).filter(([p]) => isAppOwned(p)))

// ---------------------------------------------------------------- applying a ChangeSet

/** Finds `search` in `code`: exactly once, or once when comparing trimmed lines. */
function locate(code: string, search: string): { start: number; end: number } | null {
  const s = search.replace(/\n+$/, "")
  if (!s.trim()) return null
  const first = code.indexOf(s)
  if (first !== -1 && code.indexOf(s, first + 1) === -1) return { start: first, end: first + s.length }
  const lines = code.split("\n")
  const want = s.split("\n").map((l) => l.trim())
  while (want.length && !want[0]) want.shift()
  while (want.length && !want[want.length - 1]) want.pop()
  const hits: number[] = []
  for (let i = 0; i + want.length <= lines.length; i++) if (want.every((w, j) => lines[i + j].trim() === w)) hits.push(i)
  if (hits.length !== 1) return null
  const start = lines.slice(0, hits[0]).join("\n").length + (hits[0] ? 1 : 0)
  return { start, end: start + lines.slice(hits[0], hits[0] + want.length).join("\n").length }
}

/**
 * Applies a ChangeSet to a copy of the workspace: manifest patch, recompile, file changes.
 * Returns the new workspace, or diagnostics when the change can't even be applied.
 */
export function applyChangeSet(base: Workspace, cs: ChangeSet): { ws?: Workspace; changed: string[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  let manifest = base.manifest
  if (cs.manifestPatch.length) {
    const patched = applyPatch(base.manifest, cs.manifestPatch)
    if (patched.error) return { changed: [], diagnostics: [{ gate: "manifest", code: "patch_failed", message: patched.error, file: "manifest.json" }] }
    const v = validateManifest(patched.doc)
    if (!v.manifest) return { changed: [], diagnostics: v.diagnostics }
    manifest = v.manifest
  }

  const files: FileMap = appFiles(base)
  const changed = new Set<string>()
  for (const ch of cs.files) {
    if (!isAppOwned(ch.path)) {
      diagnostics.push({
        gate: "policy",
        code: isCompilerOwned(ch.path) ? "compiler_owned" : "path_not_allowed",
        file: ch.path,
        message: isCompilerOwned(ch.path)
          ? `${ch.path} is generated from the manifest. Change the manifest (manifest_patch) instead of the file.`
          : `${ch.path} is outside the writable paths (screens/<screenId>.tsx, components/**, lib/**).`,
      })
      continue
    }
    if (ch.op === "delete") {
      delete files[ch.path]
    } else if (ch.op === "write") {
      files[ch.path] = ch.content.replace(/\r\n/g, "\n")
    } else {
      let code = files[ch.path]
      if (code === undefined) {
        diagnostics.push({ gate: "parse", code: "edit_missing_file", file: ch.path, message: `Cannot edit ${ch.path}: the file does not exist. Write the whole file instead.` })
        continue
      }
      for (const h of ch.hunks) {
        const at = locate(code, h.search)
        if (!at) {
          diagnostics.push({ gate: "parse", code: "edit_no_match", file: ch.path, message: `A SEARCH block did not match ${ch.path} exactly once. Send the whole file instead.\nSEARCH was:\n${h.search.slice(0, 400)}` })
          break
        }
        code = code.slice(0, at.start) + h.replace.replace(/\n+$/, "") + code.slice(at.end)
      }
      files[ch.path] = code
    }
    changed.add(ch.path)
  }
  if (diagnostics.length) return { changed: [...changed], diagnostics }

  const generated = compileManifest(manifest)
  for (const [p, c] of Object.entries(generated)) if (base.files[p] !== c) changed.add(p)
  return { ws: { manifest, files: { ...files, ...generated } }, changed: [...changed].sort(), diagnostics: [] }
}
