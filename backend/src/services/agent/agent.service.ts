import { and, eq } from "drizzle-orm"
import { db, projects } from "@/db"
import { getLastMessageSender, getProjectForUser, updateProjectTheme as dbUpdateTheme } from "../projects/projects.service"
import { executeRun } from "./execute"
import { parseElementRef } from "@app/shared/agent/element-context"
import { latestPlan, saveUserMessage, applyCanvasEdit as orchestratorCanvasEdit, repairFile } from "./orchestrator"
import {
  activeRun,
  eventStreamResponse,
  failQueuedRun,
  finishRun,
  holdRun,
  openRun,
  setJobId,
  silentRun,
  streamRun,
  type RunInput,
} from "./run-store"
import type { AgentPhase } from "@app/shared/agent/types"
import { agentRunner, enqueueJob, jobTimeoutSeconds, JobsError, verifyJobSignature } from "../jobs/cloudhike-jobs"
import { MAX_PROMPT_LENGTH } from "@app/shared/project-rules"
import { hasConnection } from "../cloudhike/connect"
import { parseServices } from "../cloudhike/config"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { claimRepairAttempt } from "./repair-cap"
import { AgentConfigError } from "./config"
import type { ElementEdit } from "@app/shared/preview/protocol"

export type AgentActionInput = {
  action: RunInput["action"]
  text?: string
  screenId?: string
  element?: unknown
  services?: unknown
}

export type AgentActionResult =
  | { type: "stream"; response: Response }
  | { type: "json"; status: number; body: unknown }

export async function handleAgentAction(
  userId: string,
  projectId: string,
  body: AgentActionInput,
  signal?: AbortSignal
): Promise<AgentActionResult> {
  const action = body.action
  const ACTIONS = ["start", "resume", "message", "approve", "backend"]
  if (!ACTIONS.includes(action)) {
    return { type: "json", status: 400, body: { error: "Bad request" } }
  }

  const text = String(body.text || "").trim()
  const screenId = String(body.screenId || "") || undefined
  const element = parseElementRef(body.element)
  if (action === "message" && !text) {
    return { type: "json", status: 400, body: { error: "Write a message first." } }
  }
  if (text.length > MAX_PROMPT_LENGTH) {
    return { type: "json", status: 400, body: { error: `Keep messages under ${MAX_PROMPT_LENGTH} characters.` } }
  }

  const project = await getProjectForUser(projectId, userId)
  if (!project) {
    return { type: "json", status: 404, body: { error: "Project not found." } }
  }

  const live = await activeRun(projectId)
  if (live) {
    if (live.kind === "agent" && (action === "start" || action === "resume")) {
      const resp = await streamRun(live.id, { join: true, signal })
      return { type: "stream", response: resp }
    }
    return { type: "json", status: 409, body: { error: "The agent is still working. Wait for it to finish, then send your message." } }
  }

  const status = (project.status ?? "draft") as AgentPhase

  let task: RunInput["task"] | null = null
  let extra: Partial<RunInput> = {}
  if (action === "backend") {
    if (!(await hasConnection(userId))) {
      return { type: "json", status: 409, body: { error: "Connect your CloudHike account first.", reconnect: true } }
    }
    task = "backend"
    extra = { services: parseServices(body.services), userId }
  } else if (action === "start" || action === "resume") {
    if (status === "draft" || status === "planning") task = "plan"
    else if (status === "generating") task = "generate"
    else {
      const lastSender = await getLastMessageSender(projectId)
      if (lastSender === "user") task = "plan"
    }
  } else if (action === "message") {
    task = "plan"
  } else if (action === "approve") {
    if (!(await latestPlan(projectId))) {
      return { type: "json", status: 409, body: { error: "There's no plan to approve yet." } }
    }
    task = "generate"
  }

  if (!task) {
    const resp = eventStreamResponse([{ type: "phase", phase: status }, { type: "done" }])
    return { type: "stream", response: resp }
  }

  const run = await openRun(projectId, "agent", { task, action, ...extra })
  if (!run) {
    return { type: "json", status: 409, body: { error: "The agent is still working." } }
  }

  try {
    if (action === "message") await saveUserMessage(projectId, text, screenId, element)
    if (action === "approve") await saveUserMessage(projectId, text || "Looks good, start building.")
  } catch (e) {
    await failQueuedRun(run.id, "saving the user message failed", "Could not save your message.")
    throw e
  }

  let runner: "cloudhike" | "inline"
  try {
    runner = agentRunner()
  } catch (e) {
    console.error(e)
    await failQueuedRun(run.id, String(e), "The agent isn't configured on the server yet.")
    const resp = await streamRun(run.id, { join: false, signal })
    return { type: "stream", response: resp }
  }

  if (runner === "cloudhike") {
    try {
      const job = await enqueueJob({
        path: "/api/jobs/agent",
        body: { runId: run.id },
        timeoutSeconds: jobTimeoutSeconds(),
        retries: 2,
      })
      await setJobId(run.id, job.id)
    } catch (e) {
      const message =
        e instanceof JobsError && e.status === 402
          ? "The server ran out of Cloudhike compute minutes. Top up your workspace to keep generating."
          : "Could not start the agent."
      await failQueuedRun(run.id, String(e), message)
      if (!(e instanceof JobsError)) console.error("enqueue agent job failed", run.id, e)
    }
  } else {
    void executeRun(run.id).catch((e) => console.error("in-process agent run failed", run.id, e))
  }

  const resp = await streamRun(run.id, { join: false, signal })
  return { type: "stream", response: resp }
}

export async function handleJobWorker(raw: string, signature: string | null) {
  if (!verifyJobSignature(raw, signature)) {
    return { status: 401, body: { error: "Bad signature" } }
  }

  let runId = ""
  try {
    runId = String((JSON.parse(raw) as { runId?: unknown }).runId ?? "")
  } catch {}
  if (!runId) return { status: 400, body: { error: "Bad request" } }

  const result = await executeRun(runId)
  return { status: 200, body: { runId, ...result } }
}

export async function handleCanvasEdit(
  userId: string,
  projectId: string,
  edit: ElementEdit,
  signal?: AbortSignal
) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return { status: 404, body: { error: "Project not found." } }

  let lock = await openRun(projectId, "canvas-edit")
  for (let i = 0; !lock && i < 40 && !signal?.aborted; i++) {
    if ((await activeRun(projectId))?.kind !== "canvas-edit") break
    await new Promise((r) => setTimeout(r, 100))
    lock = await openRun(projectId, "canvas-edit")
  }
  if (!lock) return { status: 409, body: { error: "The agent is busy." } }

  const release = holdRun(lock.id)
  let ok = false
  try {
    const result = await orchestratorCanvasEdit(projectId, edit, signal)
    ok = true
    if ("error" in result) return { status: 422, body: { error: result.error, extraFiles: result.extraFiles } }
    return { status: 200, body: result }
  } catch (e) {
    console.error("canvas edit failed", projectId, edit.eid, e)
    return { status: 500, body: { error: "Couldn't apply that edit." } }
  } finally {
    release()
    await finishRun(lock.id, ok ? "succeeded" : "failed").catch((e) =>
      console.error("releasing canvas-edit lock failed", e)
    )
  }
}

export async function handleThemeSwitch(userId: string, projectId: string, themeId: string) {
  const project = await getProjectForUser(projectId, userId)
  if (!project) return { status: 404, body: { error: "Project not found." } }

  const doc = readAppDoc(project.previewScreens)
  const targetTheme = doc.themes?.themes.find((t) => t.id === themeId)
  if (!targetTheme) return { status: 404, body: { error: "That theme doesn't exist." } }

  await dbUpdateTheme(projectId, userId, themeId, targetTheme.colors.primary)
  return { status: 200, body: { ok: true, themeId } }
}

export async function handleRepairFile(userId: string, projectId: string, path: string, message: string) {
  const [project] = await db
    .select({ id: projects.id, currentVersion: projects.currentVersion })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return { status: 404, body: { error: "Project not found." } }

  if (!claimRepairAttempt(projectId, project.currentVersion, path)) {
    return { status: 200, body: { fixed: false, reason: "already_tried" } }
  }

  const lock = await openRun(projectId, "repair")
  if (!lock) return { status: 409, body: { error: "The agent is busy." } }
  const release = holdRun(lock.id)
  let ok = false
  try {
    const result = await repairFile(silentRun(projectId, lock.id), projectId, path, message)
    ok = true
    if (!result) return { status: 200, body: { fixed: false } }
    return { status: 200, body: { fixed: true, ...result } }
  } catch (e) {
    console.error("repair failed", projectId, path, e)
    return {
      status: 500,
      body: {
        error:
          e instanceof AgentConfigError
            ? "The AI agent isn't configured on the server yet."
            : "Couldn't repair that file.",
      },
    }
  } finally {
    release()
    await finishRun(lock.id, ok ? "succeeded" : "failed").catch((e) =>
      console.error("releasing repair lock failed", e)
    )
  }
}

