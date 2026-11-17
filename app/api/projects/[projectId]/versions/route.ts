import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { json } from "@/lib/http"
import { listSnapshots } from "@/lib/versions/store"

export const runtime = "nodejs"

/** Every version this project has, newest first, plus which one is current. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return json({ error: "We're having trouble reaching our servers." }, 503)
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const [project] = await db
    .select({ id: projects.id, currentVersion: projects.currentVersion })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return json({ error: "Project not found." }, 404)

  const rows = await listSnapshots(projectId)
  return json({
    current: project.currentVersion,
    versions: rows.map((r) => ({ version: r.version, intent: r.intent, author: r.author, createdAt: r.createdAt.toISOString() })),
  })
}
