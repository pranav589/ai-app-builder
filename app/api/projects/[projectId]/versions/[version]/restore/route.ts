import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { activeRun } from "@/lib/agent/run-store"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { json } from "@/lib/http"
import { restoreSnapshot } from "@/lib/versions/store"

export const runtime = "nodejs"

/**
 * Restores an older version: copies its doc back onto the head as a new
 * version on top, so Undo never rewrites history. Refused while a run is
 * active, so a restore never races a build or edit writing the same project.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ projectId: string; version: string }> }) {
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return json({ error: "We're having trouble reaching our servers." }, 503)
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const { projectId, version } = await params
  const v = Number(version)
  if (!Number.isInteger(v) || v < 1) return json({ error: "Bad request" }, 400)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return json({ error: "Project not found." }, 404)

  if (await activeRun(projectId)) return json({ error: "The agent is working on this project right now. Wait for it to finish, then restore." }, 409)

  const result = await restoreSnapshot(projectId, v, { author: user.id })
  if (!result) return json({ error: "That version doesn't exist." }, 404)

  return json({ version: result.version })
}
