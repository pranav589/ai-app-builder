import { and, eq } from "drizzle-orm"

import { db, messages, projects } from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { AgentConfigError } from "./config"
import { latestPlan, NEW_SCREEN_NUDGE, routeMessage, runGeneration, runPlanning, runVerifiedEdit, setPhase } from "./orchestrator"
import { claimRun, createEventSink, finishRun, holdRun, type RunInput } from "./run-store"
import { DEFAULT_BACKEND_PROVIDER, parseServices } from "@app/shared/app-backend/providers"
import { syncBackendSchema } from "@/lib/app-backend/backend.service"
import { getProvider } from "@/lib/app-backend/registry"
import type { AgentPhase } from "@app/shared/agent/types"
import type { EditRequest } from "./protocol"
import type { LiveRun } from "./registry"

export function friendlyError(e: unknown) {
  if (e instanceof AgentConfigError) return "The AI agent isn't configured on the server yet."
  const msg = e instanceof Error ? e.message : String(e)
  if (/model not found|not deployed|inaccessible/i.test(msg))
    return "The configured AI model isn't available on the AI provider. Check AI_MODEL."
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return "The AI provider took too long to respond. Please try again."
  if (/rate limit|429/i.test(msg)) return "The AI provider is busy right now. Please try again in a minute."
  if (/401|403|api key|unauthorized/i.test(msg)) return "The AI provider rejected our credentials."
  return "Something went wrong while the agent was working. Please try again."
}

/**
 * Runs one queued agent run to the end. Called by the job queue's worker
 * route, or in-process when no queue is available. Everything is persisted as
 * it goes, so the browser can come and go. Returns false when the run was not
 * ours to take (a duplicate delivery or a run another worker holds).
 */
export async function executeRun(runId: string): Promise<{ taken: boolean; ok?: boolean }> {
  const row = await claimRun(runId)
  if (!row) return { taken: false }

  const projectId = row.projectId
  const input = row.input as RunInput
  const release = holdRun(runId)
  const run = await createEventSink(runId, projectId)
  let ok = true
  let failure: string | undefined

  try {
    if (input.task === "backend") {
      // Runs queued before providers were pluggable carry no provider: they were CloudHike's.
      const provider = getProvider(input.provider ?? DEFAULT_BACKEND_PROVIDER)
      await provider.provision(run, projectId, input.userId!, parseServices(provider.id, input.services))
    } else if (input.task === "plan") {
      // The fast router (Phase 8): a verified project with a built app gets
      // most chat messages classified and handled without the slow planner
      // call. Falls through to the planner for everything it isn't sure
      // about, exactly as if this didn't run.
      const { handled } = await routeMessage(run, projectId)
      if (!handled) {
        const hasAssistant = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.projectId, projectId), eq(messages.sender, "assistant")))
          .limit(1)
        const { approved, edit } = await runPlanning(run, projectId, { first: hasAssistant.length === 0 })
        if (approved) await generate(run, projectId)
        // Changes to built screens skip the plan and the full build.
        else if (edit) {
          const { needsPlan } = await dispatchEdit(run, projectId, edit, { escalate: true })
          // It needed a new screen after all: plan it (once), then build just that.
          if (needsPlan) {
            const again = await runPlanning(run, projectId, { first: false, nudge: NEW_SCREEN_NUDGE })
            if (again.approved) await generate(run, projectId)
            else if (again.edit) await dispatchEdit(run, projectId, again.edit)
          }
        }
      }
    } else {
      await generate(run, projectId)
    }
  } catch (e) {
    ok = false
    failure = e instanceof Error ? e.message : String(e)
    console.error("agent run failed", projectId, runId, e)
    const fallback = await fallbackPhase(projectId, input.task).catch((): AgentPhase => "draft")
    await setPhase(projectId, fallback).catch(() => {})
    run.emit({ type: "phase", phase: fallback })
    run.emit({ type: "error", message: friendlyError(e), retryable: true })
  } finally {
    release()
    // Free the project before "done" reaches the browser, so its next message is accepted.
    await finishRun(runId, ok ? "succeeded" : "failed", failure).catch((e) => console.error("finishing agent run failed", runId, e))
    run.emit({ type: "done" })
    await run.close()
  }
  return { taken: true, ok }
}

/** A build, then the connected backend's tables for any new collections. */
async function generate(run: Parameters<typeof runGeneration>[0], projectId: string) {
  await runGeneration(run, projectId)
  await syncBackendSchema(projectId)
}

/** Sends an edit through the change gateway. */
async function dispatchEdit(run: LiveRun, projectId: string, edit: EditRequest, opts: { escalate?: boolean } = {}) {
  return runVerifiedEdit(run, projectId, edit, opts)
}

/** Where a failed run leaves the project. */
async function fallbackPhase(projectId: string, task: RunInput["task"]): Promise<AgentPhase> {
  if (task === "backend") {
    const [p] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1)
    return (p?.status as AgentPhase) ?? "ready"
  }
  const [project] = await db
    .select({ previewScreens: projects.previewScreens })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  const plan = await latestPlan(projectId)
  const screens = readAppDoc(project?.previewScreens).screens
  if (task === "generate" || plan) return screens.some((s) => s.state === "ready") && task !== "generate" ? "ready" : "awaiting_approval"
  return "draft"
}
