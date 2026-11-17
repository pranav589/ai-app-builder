import "server-only"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { json } from "@/lib/http"

/** The signed-in user and their project, or the error response to send. */
export async function requireOwnedProject(projectId: string) {
  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return { error: json({ error: "We're having trouble reaching our servers. Please try again." }, 503) }
    throw e
  }
  if (!user) return { error: json({ error: "Sign in to continue." }, 401) }
  const [project] = await db
    .select({ id: projects.id, name: projects.name, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return { error: json({ error: "Project not found." }, 404) }
  return { user, project }
}
