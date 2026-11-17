import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { json } from "@/lib/http"
import { getSnapshot } from "@/lib/versions/store"
import { diffWorkspaces } from "@/lib/versions/diff"
import { workspaceFromDoc } from "@/lib/verify/workspace"

export const runtime = "nodejs"

/** What changed between a version and its parent (the version it was committed on top of). */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; version: string }> }) {
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

  const snap = await getSnapshot(projectId, v)
  if (!snap) return json({ error: "That version doesn't exist." }, 404)

  const after = workspaceFromDoc(readAppDoc(snap.doc)).files
  const before = snap.parentVersion ? workspaceFromDoc(readAppDoc((await getSnapshot(projectId, snap.parentVersion))?.doc)).files : {}
  const files = diffWorkspaces(before, after)

  return json({ version: v, parentVersion: snap.parentVersion, intent: snap.intent, files })
}
