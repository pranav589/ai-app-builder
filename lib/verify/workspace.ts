// Turns a project's AppDoc into the FileMap the gates work on, and back.
// Ported from poc/verified-code/src/core/workspace.ts, plus (Phase 6) the
// manifest patch and recompile applyChangeSet now does.

import { autoImport, projectExports, screenPath } from "@/lib/app-project/project"
import type { AppDoc } from "@/lib/app-runtime/app-doc"
import { compileManifest } from "@/lib/manifest/compile"
import { applyPatch, validateManifest, type AppManifest } from "@/lib/manifest/schema"
import { isAppOwned, isCompilerOwned, isPlatformOwned } from "./ownership"
import type { ChangeSet, Diagnostic, FileMap, Workspace } from "./types"

/** Screens' code (by path) plus every other project file, in one FileMap. */
export function workspaceFromDoc(doc: AppDoc): Workspace {
  const files: FileMap = { ...(doc.files ?? {}) }
  for (const s of doc.screens) if (s.path && s.code !== undefined) files[s.path] = s.code
  return { files, manifest: doc.manifest }
}

/**
 * Writes a workspace's files back: screen code by path, everything else into
 * doc.files, and the manifest if it changed. A manifest screen that gained a
 * file becomes a new GeneratedScreen (so it shows up on the canvas); one the
 * manifest patch removed drops its entry.
 */
export function docFromWorkspace(doc: AppDoc, ws: Workspace): AppDoc {
  const manifest = (ws.manifest as AppManifest | undefined) ?? doc.manifest
  let screens = doc.screens.map((s) =>
    s.path && ws.files[s.path] !== undefined && ws.files[s.path] !== s.code ? { ...s, code: ws.files[s.path], state: "ready" as const, error: undefined } : s
  )
  if (manifest) {
    screens = screens.filter((s) => manifest.screens[s.id])
    const known = new Set(screens.map((s) => s.id))
    for (const [id, screen] of Object.entries(manifest.screens)) {
      if (known.has(id)) continue
      const path = screenPath({ id, presentation: screen.presentation })
      const code = ws.files[path]
      if (code === undefined) continue
      screens.push({ id, name: screen.title, state: "ready", path, code })
    }
  }
  const allScreenPaths = new Set(screens.filter((s) => s.path).map((s) => s.path!))
  const files = Object.fromEntries(Object.entries(ws.files).filter(([p]) => !allScreenPaths.has(p)))
  return { ...doc, screens, files, manifest }
}

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
 * Applies a ChangeSet to a copy of the workspace: file writes, edits and
 * deletes. (From Phase 6: the manifest patch and recompile too.) Returns the
 * new workspace, or diagnostics when the change can't even be applied.
 */
export function applyChangeSet(base: Workspace, cs: ChangeSet): { ws?: Workspace; changed: string[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const files: FileMap = { ...base.files }
  const changed = new Set<string>()
  let manifest = base.manifest as AppManifest | undefined

  if (cs.manifestPatch.length) {
    if (!manifest) return { changed: [], diagnostics: [{ gate: "manifest", code: "no_manifest", severity: "error", message: "This project has no manifest to patch yet." }] }
    const patched = applyPatch(manifest, cs.manifestPatch)
    if (patched.error) return { changed: [], diagnostics: [{ gate: "manifest", code: "patch_failed", severity: "error", message: patched.error }] }
    const validated = validateManifest(patched.doc)
    if (!validated.manifest) return { changed: [], diagnostics: validated.diagnostics }
    manifest = validated.manifest
  }

  for (const ch of cs.files) {
    if (ch.path.includes("..")) {
      diagnostics.push({ gate: "policy", code: "path_not_allowed", severity: "error", file: ch.path, message: `"${ch.path}" is not a valid project path.` })
      continue
    }
    if (!isAppOwned(ch.path)) {
      diagnostics.push({
        gate: "policy",
        code: isPlatformOwned(ch.path) ? "platform_owned" : isCompilerOwned(ch.path) ? "compiler_owned" : "path_not_allowed",
        severity: "error",
        file: ch.path,
        message: isPlatformOwned(ch.path)
          ? `${ch.path} is a platform file; it can't be changed this way.`
          : isCompilerOwned(ch.path)
            ? `${ch.path} is generated and will be overwritten by the compiler; it can't be written directly.`
            : `${ch.path} is outside the writable paths (screens under app/, components/**, lib/**).`,
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
        diagnostics.push({ gate: "parse", code: "edit_missing_file", severity: "error", file: ch.path, message: `Cannot edit ${ch.path}: the file doesn't exist. Write the whole file instead.` })
        continue
      }
      let ok = true
      for (const h of ch.hunks) {
        const at = locate(code, h.search)
        if (!at) {
          diagnostics.push({
            gate: "parse",
            code: "edit_no_match",
            severity: "error",
            file: ch.path,
            message: `A SEARCH block didn't match ${ch.path} exactly once. Send the whole file instead.\nSEARCH was:\n${h.search.slice(0, 400)}`,
          })
          ok = false
          break
        }
        code = code.slice(0, at.start) + h.replace.replace(/\n+$/, "") + code.slice(at.end)
      }
      if (ok) files[ch.path] = code
    }
    changed.add(ch.path)
  }
  if (diagnostics.length) return { changed: [...changed], diagnostics }

  // A missing import is the model's most common slip, and it's a name the
  // project already has (its own exports or a well-known API); fix it
  // deterministically rather than spending a repair round on it. Retired
  // once first-pass rates show the model doesn't need it anymore.
  const exports = projectExports(files)
  for (const path of changed) {
    if (!isAppOwned(path)) continue
    const code = files[path]
    if (code === undefined) continue // deleted
    const fixed = autoImport(code, exports)
    if (fixed !== code) {
      console.info(`[verify] autoImport added an import in ${path}`)
      files[path] = fixed
    }
  }

  if (manifest && cs.manifestPatch.length) {
    const generated = compileManifest(manifest)
    for (const [path, code] of Object.entries(generated)) {
      if (files[path] !== code) changed.add(path)
      files[path] = code
    }
    // A screen declared in the manifest needs a file in the same change (or already written earlier); the model forgetting one is the mistake this catches.
    for (const [id, screen] of Object.entries(manifest.screens)) {
      const path = screenPath({ id, presentation: screen.presentation })
      if (files[path] === undefined) {
        diagnostics.push({
          gate: "manifest",
          code: "screen_missing_file",
          severity: "error",
          file: path,
          message: `The manifest has a screen "${id}" but no file at ${path}. Add it with a <file path="${path}"> block in the same change.`,
        })
      }
    }
    if (diagnostics.length) return { changed: [...changed], diagnostics }
  }

  return { ws: { manifest, files }, changed: [...changed].sort(), diagnostics: [] }
}
