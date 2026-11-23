import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { ensureManifest } from "@app/shared/manifest/migrate"
import type { ElementEdit } from "@app/shared/preview/protocol"
import { applyElementEdit, parseEid } from "@/lib/verify/codemod"
import { isAppOwned } from "@app/shared/verify/ownership"
import { formatDiagnostics, verifyChange } from "@/lib/verify/pipeline"
import { docFromWorkspace, workspaceFromDoc } from "@/lib/verify/workspace"
import { commitSnapshot } from "@/lib/versions/store"
import { latestPlan, loadProject } from "./history"
import { withCurrentPlatform } from "./verify-glue"

/** An edit the codemod couldn't place, with why. The rest of the batch is still saved. */
export type CanvasEditFailure = { eid: string; error: string }

export type CanvasEditResult =
  | { files: Record<string, string>; version: number; failed: CanvasEditFailure[]; extraFiles?: Record<string, string> }
  | { error: string; failed: CanvasEditFailure[]; extraFiles?: Record<string, string> }

/**
 * Tap-to-select text/style/image edits from the canvas inspector (Phase 8,
 * item 3), saved together when the user clicks Done, with no model call. An
 * AST codemod (lib/verify/codemod.ts) rewrites the JSX element at each
 * edit's eid ("file:line:Tag"); edits it can't place are reported in
 * `failed` and skipped. Everything it could place goes through the same
 * gates an AI edit does (parse/policy/tsc/render) once, as one change and
 * one version: either all of it is kept or none of it.
 */
export async function applyCanvasEdits(projectId: string, edits: ElementEdit[], signal?: AbortSignal): Promise<CanvasEditResult> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const manifest = ensureManifest(doc, await latestPlan(projectId))
  if (!manifest) return { error: "This project isn't built yet.", failed: [] }
  // Platform files are resynced here too (see withCurrentPlatform), and the
  // ones that changed are reported back as `extraFiles` (even when the edits
  // fail) so the running preview picks them up right away: an eid pointing
  // inside kit/index.tsx, from a stale copy that didn't forward data-eid to
  // its own elements, is exactly the bug this resync fixes for the *next* tap.
  const stored = workspaceFromDoc({ ...doc, manifest })
  const ws = withCurrentPlatform(stored)
  const updates = Object.fromEntries(Object.entries(ws.files).filter(([p, code]) => stored.files[p] !== code))
  const extraFiles = Object.keys(updates).length ? updates : undefined

  // Edits to the same file apply one after another. The codemod never adds
  // or removes lines, so the later edits' eids still point at their elements.
  const changed: Record<string, string> = {}
  const failed: CanvasEditFailure[] = []
  for (const edit of edits) {
    const fail = (error: string) => failed.push({ eid: edit.eid, error })
    const target = parseEid(edit.eid)
    if (!target) {
      fail("Couldn't place that element in the source.")
      continue
    }
    // Shared code (the kit, the theme, compiler-written layouts): an edit there
    // would change every screen using it, not the element that was tapped.
    if (!isAppOwned(target.file)) {
      fail("That part is shared by the whole app, so it can't be edited here. Ask in chat instead.")
      continue
    }
    const code = changed[target.file] ?? ws.files[target.file]
    if (code === undefined) {
      fail("That file isn't part of the project anymore.")
      continue
    }
    const result = applyElementEdit(code, target, { text: edit.text, from: edit.from, style: edit.style, imageSrc: edit.imageSrc })
    if ("error" in result) fail(result.error)
    else if (result.code !== code) changed[target.file] = result.code
  }

  const paths = Object.keys(changed).filter((p) => changed[p] !== ws.files[p])
  if (!paths.length) return { error: failed[0]?.error ?? "Nothing to change.", failed, extraFiles }
  // The browser went away mid-save: nothing is kept for it.
  const cancelled = { error: "Cancelled.", failed }
  if (signal?.aborted) return cancelled

  const verdict = await verifyChange(
    ws,
    { intent: "Inline edit", manifestPatch: [], files: paths.map((path) => ({ path, op: "write", content: changed[path] })) },
    projectId
  )
  if (signal?.aborted) return cancelled
  if (!verdict.ok) return { error: formatDiagnostics(verdict), failed, extraFiles }

  const updatedDoc = docFromWorkspace(doc, verdict.ws!)
  const { version } = await commitSnapshot(projectId, updatedDoc, { author: project.userId, intent: "Inline edit" })
  const files: Record<string, string> = {}
  for (const path of paths) {
    const code = updatedDoc.screens.find((s) => s.path === path)?.code ?? updatedDoc.files?.[path]
    if (code !== undefined) files[path] = code
  }
  return { files, version, failed, extraFiles }
}
