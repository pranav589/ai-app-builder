// Converts a project's data-access code between the two states this
// builder's generated apps can be in: local (Zustand stores, or useState)
// and connected (Axios + React Query against the REST routes, through
// @/lib/api). This is the piece that makes "Connect Backend"/"Disconnect"
// a real rewrite instead of an instant file swap (with-backend.ts's legacy
// swap is for apps generated before this existed) -- styling and layout are
// frozen by the uiFreeze gate, so only how data is read and written changes.

import { emptyDataModel } from "@app/shared/app-runtime/data-model"
import { readAppDoc, type AppDoc } from "@app/shared/app-runtime/app-doc"
import { importsOf, isCodeFile } from "@app/shared/app-project/project"
import { isAppOwned } from "@app/shared/verify/ownership"
import { compileManifest } from "@app/shared/manifest/compile"
import type { AppManifest } from "@app/shared/manifest/schema"
import type { Workspace } from "@app/shared/verify/types"
import { apiClientFiles, API_CONFIG_PATH, API_PATH, withApiClientDeps } from "@/lib/app-project/api-client"
import { builderUrl } from "@/lib/app-project/with-backend"
import { ensureAppKey, getBackend } from "@/lib/app-backend/app-backend"
import { conversionPrompt, type ConversionDirection } from "@/lib/verify/conversion-prompts"
import { conversionCoderAdapter } from "@/lib/verify/conversion-coder"
import { uiFreezeGate } from "@/lib/verify/gates/ui-freeze"
import { runChange } from "@/lib/verify/run"
import { docFromWorkspace } from "@/lib/verify/workspace"
import { commitSnapshot } from "@/lib/versions/store"
import { loadProject } from "./history"
import type { LiveRun } from "./registry"

const say = (run: LiveRun | null, text: string) => run?.emit({ type: "status", text })

/** `stores/**` plus every app-owned file importing a store or "@/data/seed.json" (connect), or "@/lib/api" (disconnect). Exported for its own test coverage. */
export function pickTargets(files: Record<string, string>, direction: ConversionDirection): string[] {
  const targets = new Set<string>()
  for (const [path, code] of Object.entries(files)) {
    if (!isCodeFile(path) || !code) continue
    if (path.startsWith("stores/")) {
      targets.add(path)
      continue
    }
    if (!isAppOwned(path)) continue
    const specs = importsOf(code)
    const matches =
      direction === "connect" ? specs.some((s) => s.startsWith("@/stores/") || s === "@/data/seed.json") : specs.some((s) => s === "@/lib/api")
    if (matches) targets.add(path)
  }
  return [...targets]
}

/**
 * Runs the conversion and commits it as one version. A failed conversion
 * (verification exhausted its repair budget) is never thrown: the backend
 * connection itself still goes through, just with its screens unconverted,
 * since leaving the app on working local data beats leaving it half-broken.
 */
export async function convertBackend(run: LiveRun | null, projectId: string, direction: ConversionDirection): Promise<{ converted: boolean; message?: string; doc?: AppDoc }> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  if (!doc.manifest) return { converted: false, message: "This project isn't built yet." }

  let files: Record<string, string> = { ...(doc.files ?? {}) }
  for (const s of doc.screens) if (s.path && s.code !== undefined) files[s.path] = s.code

  if (direction === "connect") {
    const row = await getBackend(projectId)
    if (!row) return { converted: false, message: "No backend is connected for this project." }
    const appKey = await ensureAppKey(row)
    const endpoint = `${await builderUrl()}/api/app-runtime/${encodeURIComponent(projectId)}`
    files = { ...files, ...apiClientFiles(projectId, endpoint, appKey) }
    if (files["package.json"]) files["package.json"] = withApiClientDeps(files["package.json"])
  } else {
    delete files[API_PATH]
    delete files[API_CONFIG_PATH]
  }

  // Recompiled BEFORE verification, not after: a converted screen's
  // useQuery/useMutation reads its QueryClient from context (no client
  // passed explicitly), so the render gate mounting it during the
  // conversion's own verification needs the connected root layout already
  // wrapping it in QueryClientProvider, the same as the real app will.
  for (const [path, code] of Object.entries(compileManifest(doc.manifest as AppManifest, { connected: direction === "connect" }))) files[path] = code

  const targets = pickTargets(files, direction)
  let message: string | undefined
  if (targets.length) {
    say(run, direction === "connect" ? "Switching the app's screens to the connected backend" : "Switching the app's screens back to local storage")
    const ws: Workspace = { files, manifest: doc.manifest, connected: direction === "connect" }
    const targetFiles = targets.map((path) => ({ path, code: files[path] }))
    const prompt = conversionPrompt(direction, targetFiles, doc.data ?? emptyDataModel())

    const result = await runChange(ws, prompt, conversionCoderAdapter, { extraGates: [uiFreezeGate], projectKey: `${projectId}:conversion` })
    if (result.state === "needs_user") {
      console.warn(`[backend-conversion] ${projectId} (${direction}) didn't verify: ${result.message}`)
      message = `Some screens couldn't be converted automatically (${result.message}). You can ask to fix them from the chat.`
    } else {
      files = result.ws.files
    }
  }

  // doc.backend is read fresh above: the caller (provision.ts on connect,
  // disconnectBackend on disconnect) already points it at the new provider
  // before calling this, so docFromWorkspace's spread carries it through
  // unchanged -- this never sets it itself.
  const updatedDoc = docFromWorkspace(doc, { files, manifest: doc.manifest })
  const { doc: committedDoc } = await commitSnapshot(projectId, updatedDoc, { intent: direction === "connect" ? "Connected backend" : "Disconnected backend" })

  // The client builds its preview and code tab from the event stream, not a
  // fresh read of the commit, so without these it keeps the pre-conversion
  // code until the page is reloaded. committedDoc (not updatedDoc): the commit may prune files.
  for (const screen of committedDoc.screens) {
    if (screen.code !== undefined && screen.code !== (doc.screens.find((s) => s.id === screen.id)?.code)) run?.emit({ type: "screen_done", screen })
  }
  run?.emit({ type: "files", files: committedDoc.files ?? {} })
  return { converted: true, message, doc: committedDoc }
}
