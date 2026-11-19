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
import { latestPlan, loadProject } from "./history"
import type { LiveRun } from "./registry"
import { emitAttempts, verifyDebugFail, withCurrentKit } from "./verify-glue"

export type RepairResult = { path: string; code: string; screenId?: string } | null

/**
 * Fixes a file that crashed in the preview, through the same change gateway
 * as an edit: the crash message becomes the instruction, the gates
 * (parse/policy/tsc/render) decide whether the fix is safe, and the result
 * is only saved if it actually changed something.
 */
export async function repairFile(run: LiveRun, projectId: string, path: string, message: string): Promise<RepairResult> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  const screen = doc.screens.find((s) => s.path === path && s.code)
  const code = screen?.code ?? doc.files?.[path]
  if (!code) return null
  const label = screen?.name ?? path.split("/").pop() ?? path

  const manifest = ensureManifest(doc, await latestPlan(projectId))
  if (!manifest) return null
  const ws = withCurrentKit(workspaceFromDoc({ ...doc, manifest }))
  const exports = projectExports(ws.files)
  const prompt = verifiedEditPrompt(`In the running app, ${path} crashed with: "${message.slice(0, 500)}". Find the cause and fix it.`, selectFiles(ws, [path]), {
    manifest,
    components: Object.entries(exports).map(([n, e]) => `${n} (${e.module})`).join(", "),
    data: doc.data ?? emptyDataModel(),
  })
  const result = await runChange(ws, prompt, coderAdapter, {
    debugFail: verifyDebugFail(),
    projectKey: projectId,
    onState: (state) => run.emit({ type: "run_state", state }),
  })
  emitAttempts(run, result.attempts)
  if (result.state === "needs_user") return null

  const updatedDoc = docFromWorkspace(doc, result.ws)
  await commitSnapshot(projectId, updatedDoc, { author: project.userId, intent: `Repaired ${label}`, runId: run.runId })
  const newCode = updatedDoc.screens.find((s) => s.path === path)?.code ?? updatedDoc.files?.[path]
  if (newCode === undefined || newCode === code) return null
  return screen ? { path, code: newCode, screenId: screen.id } : { path, code: newCode }
}
