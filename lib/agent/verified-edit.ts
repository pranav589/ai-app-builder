import "server-only"

import { emptyDataModel } from "@/lib/app-runtime/data-model"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { projectExports } from "@/lib/app-project/project"
import { ensureManifest } from "@/lib/manifest/migrate"
import { coderAdapter } from "@/lib/verify/coder"
import { selectFiles } from "@/lib/verify/context"
import { verifiedEditPrompt } from "@/lib/verify/prompts"
import { runChange } from "@/lib/verify/run"
import { docFromWorkspace, workspaceFromDoc } from "@/lib/verify/workspace"
import { commitSnapshot } from "@/lib/versions/store"
import { latestPlan, loadProject, saveMessage, setPhase } from "./history"
import type { EditRequest } from "./protocol"
import type { LiveRun } from "./registry"
import { emitAttempts, verifyDebugFail, withCurrentKit } from "./verify-glue"

/**
 * The edit path: builds a Workspace from the AppDoc, runs the change
 * gateway (lib/verify/run.ts) with the coder model, and on success commits
 * a snapshot. On `needs_user`, posts a plain-words message and leaves the
 * app unchanged.
 *
 * With `escalate`, a change that turns out to need a new screen (the coder
 * says so, writes a new route file, or the edit targets a screen that
 * doesn't exist) returns { needsPlan: true } without saving anything, so the
 * caller can send it through the plan instead of dropping it.
 */
export async function runVerifiedEdit(run: LiveRun, projectId: string, edit: EditRequest, opts: { escalate?: boolean } = {}): Promise<{ needsPlan: boolean }> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const ready = doc.screens.filter((s) => s.state === "ready" && s.code && s.path)
  const manifest = ensureManifest(doc, await latestPlan(projectId))
  if (!manifest) return { needsPlan: true }
  const ws = withCurrentKit(workspaceFromDoc({ ...doc, manifest }))

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const targetPaths = new Set<string>()
  let unknownScreen = false
  for (const t of edit.targets) {
    const screen = ready.find((s) => s.id === t || norm(s.name) === norm(t) || s.path === t)
    if (screen) targetPaths.add(screen.path!)
    else if (ws.files[t.replace(/^@\//, "")]) targetPaths.add(t.replace(/^@\//, ""))
    else if (!t.includes("/") || /^app\//.test(t)) unknownScreen = true
  }
  if (opts.escalate && unknownScreen) return { needsPlan: true }
  if (!targetPaths.size && ready[0]) targetPaths.add(ready[0].path!)
  const nameOf = (path: string) => ready.find((s) => s.path === path)?.name ?? path.split("/").pop()!.replace(/\.\w+$/, "")
  const label = [...targetPaths].map(nameOf).join(", ")

  run.emit({ type: "status", text: `Editing ${label}`, since: Date.now() })
  const prompt = verifiedEditPrompt(
    edit.instruction,
    selectFiles(ws, [...targetPaths]),
    {
      manifest,
      components: Object.entries(projectExports(ws.files)).map(([n, e]) => `${n} (${e.module})`).join(", "),
      data: doc.data ?? emptyDataModel(),
    }
  )

  const result = await runChange(ws, prompt, coderAdapter, {
    debugFail: verifyDebugFail(),
    projectKey: projectId,
    onState: (state) => {
      run.emit({ type: "run_state", state })
      run.emit({ type: "status", text: state === "repairing" ? `Fixing ${label}` : `Editing ${label}`, since: Date.now() })
    },
  })
  emitAttempts(run, result.attempts)

  if (result.state === "needs_user") {
    const msg = await saveMessage(projectId, { sender: "assistant", kind: "standard", text: result.message })
    run.emit({ type: "message_done", message: msg })
    await setPhase(projectId, "ready")
    run.emit({ type: "phase", phase: "ready" })
    return { needsPlan: false }
  }

  const updatedDoc = docFromWorkspace(doc, result.ws)
  const { version } = await commitSnapshot(projectId, updatedDoc, {
    author: project.userId,
    intent: result.intent || `Edit: ${edit.instruction.slice(0, 140)}`,
    runId: run.runId,
  })
  for (const path of result.changed) {
    const screen = updatedDoc.screens.find((s) => s.path === path)
    if (screen) run.emit({ type: "screen_done", screen })
  }
  if (result.changed.some((p) => !updatedDoc.screens.some((s) => s.path === p))) run.emit({ type: "files", files: updatedDoc.files ?? {} })

  // The model's own one-sentence <intent> often carries something worth
  // telling the user (e.g. it built the closest version of an unsupported
  // request and said what's missing); a generic "Updated X." would bury that
  // in the Versions panel instead of surfacing it where the user is looking.
  const msg = await saveMessage(projectId, { sender: "assistant", kind: "standard", text: result.intent || `Updated ${label}.`, version })
  run.emit({ type: "message_done", message: msg })
  await setPhase(projectId, "ready")
  run.emit({ type: "phase", phase: "ready" })
  return { needsPlan: false }
}
