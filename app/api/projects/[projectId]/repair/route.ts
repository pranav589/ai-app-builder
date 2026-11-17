import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { AgentConfigError } from "@/lib/agent/config"
import { repairFile } from "@/lib/agent/orchestrator"
import { finishRun, holdRun, openRun, silentRun } from "@/lib/agent/run-store"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Repairs a generated file that crashed in the preview. Called by the
 * workspace when a frame reports a runtime error; the fixed file is saved and
 * returned so every frame picks it up without a reload.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return json({ error: "We're having trouble reaching our servers." }, 503)
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const body = await readJson(req)
  const path = str(body?.path)
  const message = str(body?.message).slice(0, 1000)
  if (!path || !message || path.includes("..")) return json({ error: "Bad request" }, 400)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return json({ error: "Project not found." }, 404)

  // One agent job per project at a time; a build in progress wins.
  const lock = await openRun(projectId, "repair")
  if (!lock) return json({ error: "The agent is busy." }, 409)
  const release = holdRun(lock.id)
  let ok = false
  try {
    const result = await repairFile(silentRun(projectId, lock.id), projectId, path, message)
    ok = true
    if (!result) return json({ fixed: false })
    return json({ fixed: true, ...result })
  } catch (e) {
    console.error("repair failed", projectId, path, e)
    return json({ error: e instanceof AgentConfigError ? "The AI agent isn't configured on the server yet." : "Couldn't repair that file." }, 500)
  } finally {
    release()
    await finishRun(lock.id, ok ? "succeeded" : "failed").catch((e) => console.error("releasing repair lock failed", e))
  }
}
