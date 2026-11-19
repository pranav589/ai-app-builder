import "server-only"
import { and, desc, eq } from "drizzle-orm"

import { db, messages } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { ensureManifest } from "@/lib/manifest/migrate"
import { parseRouterReply, routerPrompt } from "@/lib/verify/router"
import { getAgents, streamText } from "./agents"
import { describeElement, elementFile, parseElementRef } from "./element-context"
import { latestPlan, loadProject, saveMessage, setPhase } from "./history"
import type { LiveRun } from "./registry"
import { runVerifiedEdit } from "./verified-edit"

/** Sent to the planner when a request turned out to need a new screen. */
export const NEW_SCREEN_NUDGE =
  "The person's latest request may need a new screen, which an <edit> cannot do (the editor can only change files that already exist). If it does, reply again: one short sentence saying you are adding it now, then the full updated <plan> with every existing screen unchanged and the new screen added, and no <edit> block. If it really is only a change to existing screens, reply with the <edit> as before."

/**
 * Phase 8 fast path: for a project that already has a built app, classify
 * the latest message before running the slow, streaming planner on it.
 * "edit" goes straight to the coder with focused context; "question",
 * "integration" and "unsupported" are answered directly, no ChangeSet. Every
 * other case (add_screen, structure, an unparseable router reply, or
 * nothing built yet) returns `{ handled: false }` so the caller falls back
 * to the planner exactly as it did before this existed.
 */
export async function routeMessage(run: LiveRun, projectId: string): Promise<{ handled: boolean }> {
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)
  if (!doc.screens.some((s) => s.state === "ready")) return { handled: false }

  const [lastUser] = await db
    .select({ text: messages.text, pipelineData: messages.pipelineData })
    .from(messages)
    .where(and(eq(messages.projectId, projectId), eq(messages.sender, "user")))
    .orderBy(desc(messages.createdAt))
    .limit(1)
  if (!lastUser?.text) return { handled: false }
  // A selected element makes "this"/"it" mean something specific: both the
  // router and the coder are told which one, and the edit targets its file.
  const element = parseElementRef((lastUser.pipelineData as { element?: unknown } | null)?.element)
  const message = element ? `${describeElement(element)}\n${lastUser.text}` : lastUser.text

  const manifest = ensureManifest(doc, await latestPlan(projectId))
  if (!manifest) return { handled: false }

  run.emit({ type: "status", text: "Reading your message" })
  const { router } = getAgents()
  let raw = ""
  try {
    raw = await streamText(router, routerPrompt(manifest, message), () => {})
  } catch (e) {
    console.warn("router call failed, falling back to the planner", e instanceof Error ? e.message : e)
    return { handled: false }
  }
  const reply = parseRouterReply(raw)
  if (!reply || reply.route === "add_screen" || reply.route === "structure") return { handled: false }

  if (reply.route === "edit") {
    run.emit({ type: "run_state", state: "routed" })
    const { needsPlan } = await runVerifiedEdit(run, projectId, {
      targets: element ? [...new Set([elementFile(element), ...reply.targets])] : reply.targets,
      instruction: message,
    })
    return { handled: !needsPlan }
  }

  // question / integration / unsupported: answered directly, no ChangeSet, no new version.
  run.emit({ type: "run_state", state: "answered" })
  const msg = await saveMessage(projectId, { sender: "assistant", kind: "standard", text: reply.answer || "Could you say a bit more about what you'd like changed?" })
  run.emit({ type: "message_done", message: msg })
  await setPhase(projectId, "ready")
  run.emit({ type: "phase", phase: "ready" })
  return { handled: true }
}
