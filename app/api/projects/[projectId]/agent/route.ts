import { and, desc, eq } from "drizzle-orm"

import { db, messages, projects } from "@/db"
import { executeRun } from "@/lib/agent/execute"
import { latestPlan, saveUserMessage } from "@/lib/agent/orchestrator"
import {
  activeRun,
  eventStreamResponse,
  failQueuedRun,
  openRun,
  setJobId,
  streamRun,
  type RunInput,
} from "@/lib/agent/run-store"
import type { AgentPhase } from "@/lib/agent/types"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"
import { agentRunner, enqueueJob, jobTimeoutSeconds, JobsError } from "@/lib/jobs/cloudhike-jobs"
import { MAX_PROMPT_LENGTH } from "@/lib/project-rules"
import { hasConnection } from "@/lib/cloudhike/connect"
import { parseServices } from "@/lib/cloudhike/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// The response streams for as long as the run lasts (the run itself executes
// in a Cloudhike Jobs worker, or in-process in local dev).
export const maxDuration = 800

type Action = RunInput["action"]
const ACTIONS: Action[] = ["start", "resume", "message", "approve", "backend"]

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError)
      return json({ error: "We're having trouble reaching our servers. Please try again." }, 503)
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const body = await readJson(req)
  const action = str(body?.action) as Action
  if (!ACTIONS.includes(action)) return json({ error: "Bad request" }, 400)
  const text = str(body?.text).trim()
  const screenId = str(body?.screenId) || undefined
  if (action === "message" && !text) return json({ error: "Write a message first." }, 400)
  if (text.length > MAX_PROMPT_LENGTH) return json({ error: `Keep messages under ${MAX_PROMPT_LENGTH} characters.` }, 400)

  const [project] = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return json({ error: "Project not found." }, 404)

  // A run is already going (another tab, or this page before a reload).
  const live = await activeRun(projectId)
  if (live) {
    if (live.kind === "agent" && (action === "start" || action === "resume"))
      return streamRun(live.id, { join: true, signal: req.signal })
    return json({ error: "The agent is still working. Wait for it to finish, then send your message." }, 409)
  }

  const status = (project.status ?? "draft") as AgentPhase

  // What this request should do, given where the project is.
  let task: RunInput["task"] | null = null
  let extra: Partial<RunInput> = {}
  if (action === "backend") {
    // Set up (or repair) the app's CloudHike backend with the creator's own account.
    if (!(await hasConnection(user.id)))
      return json({ error: "Connect your CloudHike account first.", reconnect: true }, 409)
    task = "backend"
    extra = { services: parseServices(body?.services), userId: user.id }
  } else if (action === "start" || action === "resume") {
    // "planning"/"generating" with no live run: a worker died mid-run, so pick it up again.
    if (status === "draft" || status === "planning") task = "plan"
    else if (status === "generating") task = "generate"
    else {
      // The last message is the user's and was never answered (e.g. the provider failed): answer it now.
      const [last] = await db
        .select({ sender: messages.sender })
        .from(messages)
        .where(eq(messages.projectId, projectId))
        .orderBy(desc(messages.createdAt))
        .limit(1)
      if (last?.sender === "user") task = "plan"
    }
  } else if (action === "message") {
    task = "plan"
  } else if (action === "approve") {
    if (!(await latestPlan(projectId))) return json({ error: "There's no plan to approve yet." }, 409)
    task = "generate"
  }

  if (!task) return eventStreamResponse([{ type: "phase", phase: status }, { type: "done" }])

  // The partial unique index makes this the one place a run can start.
  const run = await openRun(projectId, "agent", { task, action, ...extra })
  if (!run) return json({ error: "The agent is still working." }, 409)

  // Saved before the run is queued, so a reload shows the message even while it waits for a worker.
  try {
    if (action === "message") await saveUserMessage(projectId, text, screenId)
    if (action === "approve") await saveUserMessage(projectId, text || "Looks good, start building.")
  } catch (e) {
    await failQueuedRun(run.id, "saving the user message failed", "Couldn't save your message. Please try again.")
    throw e
  }

  let runner: "cloudhike" | "inline"
  try {
    runner = agentRunner()
  } catch (e) {
    console.error(e)
    await failQueuedRun(run.id, String(e), "The agent isn't configured on the server yet.")
    return streamRun(run.id, { join: false, signal: req.signal })
  }

  if (runner === "cloudhike") {
    try {
      const job = await enqueueJob({
        path: "/api/jobs/agent",
        body: { runId: run.id },
        timeoutSeconds: jobTimeoutSeconds(),
        // Safe: a repeat delivery of a run already taken is a no-op.
        retries: 2,
      })
      await setJobId(run.id, job.id)
    } catch (e) {
      console.error("queueing agent run failed", projectId, e)
      const busy = e instanceof JobsError && e.status === 429
      await failQueuedRun(
        run.id,
        String(e),
        busy ? "Too many builds are running right now. Please try again in a minute." : "The agent couldn't start. Please try again."
      )
    }
  } else {
    // Local dev: no public URL for Cloudhike to call, so run here. Same path, same events.
    void executeRun(run.id).catch((e) => console.error("agent run crashed", projectId, run.id, e))
  }

  return streamRun(run.id, { join: false, signal: req.signal })
}
