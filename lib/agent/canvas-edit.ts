import "server-only"

import { KIT_PATH, KIT_SOURCE } from "@/lib/app-project/kit"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { ensureManifest } from "@/lib/manifest/migrate"
import type { ElementEdit } from "@/lib/preview/protocol"
import { applyElementEdit, parseEid } from "@/lib/verify/codemod"
import { isAppOwned } from "@/lib/verify/ownership"
import { formatDiagnostics, verifyChange } from "@/lib/verify/pipeline"
import { docFromWorkspace, workspaceFromDoc } from "@/lib/verify/workspace"
import { commitSnapshot } from "@/lib/versions/store"
import { latestPlan, loadProject } from "./history"
import { withCurrentKit } from "./verify-glue"

export type CanvasEditResult = { path: string; code: string; version: number; extraFiles?: Record<string, string> } | { error: string; extraFiles?: Record<string, string> }

/**
 * A tap-to-select text/style edit from the canvas inspector (Phase 8, item
 * 3), applied with no model call: an AST codemod (lib/verify/codemod.ts)
 * rewrites the JSX element at the edit's eid ("file:line:Tag"), then the
 * result goes through the same gates an AI edit does (parse/policy/tsc/
 * render) before it's kept.
 */
export async function applyCanvasEdit(projectId: string, edit: ElementEdit, signal?: AbortSignal): Promise<CanvasEditResult> {
  // The browser abandons a save when a newer edit supersedes it; nothing is kept for it.
  const superseded = { error: "Superseded by a newer edit." }
  const target = parseEid(edit.eid)
  if (!target) return { error: "Couldn't place that element in the source." }

  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const manifest = ensureManifest(doc, await latestPlan(projectId))
  if (!manifest) return { error: "This project isn't built yet." }
  // kit/index.tsx is a pure constant (unlike theme/backend, nothing about it
  // is per-project), so a project built before a kit fix landed can safely
  // pick it up here instead of waiting for a full rebuild. Reported back as
  // `extraFiles` (even when the edit itself fails) so the running preview
  // picks it up right away: an eid pointing inside kit/index.tsx, from a
  // stale copy that didn't forward data-eid to its own elements, is exactly
  // the bug this resync fixes for the *next* tap.
  const stale = doc.files?.[KIT_PATH] !== KIT_SOURCE
  const extraFiles = stale ? { [KIT_PATH]: KIT_SOURCE } : undefined
  const ws = withCurrentKit(workspaceFromDoc({ ...doc, manifest }))
  // Shared code (the kit, the theme, compiler-written layouts): an edit there
  // would change every screen using it, not the element that was tapped.
  if (!isAppOwned(target.file)) return { error: "That part is shared by the whole app, so it can't be edited here. Ask in chat instead.", extraFiles }
  const code = ws.files[target.file]
  if (code === undefined) return { error: "That file isn't part of the project anymore.", extraFiles }

  let result = applyElementEdit(code, target, { text: edit.text, from: edit.from, style: edit.style })
  // The abandoned save before this one may have landed, leaving its text in the source.
  if ("error" in result && edit.text !== undefined && edit.fromAlt !== undefined) {
    result = applyElementEdit(code, target, { text: edit.text, from: edit.fromAlt, style: edit.style })
  }
  if ("error" in result) return { error: result.error, extraFiles }
  if (signal?.aborted) return superseded
  const next = result.code
  if (next === code) return { error: "Nothing to change.", extraFiles }

  const verdict = await verifyChange(ws, { intent: "Inline edit", manifestPatch: [], files: [{ path: target.file, op: "write", content: next }] }, projectId)
  if (signal?.aborted) return superseded
  if (!verdict.ok) return { error: formatDiagnostics(verdict), extraFiles }

  const updatedDoc = docFromWorkspace(doc, verdict.ws!)
  const { version } = await commitSnapshot(projectId, updatedDoc, { author: project.userId, intent: "Inline edit" })
  const newCode = updatedDoc.screens.find((s) => s.path === target.file)?.code ?? updatedDoc.files?.[target.file]
  if (newCode === undefined) return { error: "Couldn't apply that edit there.", extraFiles }
  return { path: target.file, code: newCode, version, extraFiles }
}
