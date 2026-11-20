import { deleteProjectForUser, renameProject } from "@/db/projects"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, isSameOrigin, json, readJson, str } from "@/lib/http"
import { deleteObjects } from "@/lib/storage"

export const runtime = "nodejs"

async function currentUserOr503() {
  try {
    return { user: await getCurrentUser() }
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return { unavailable: true as const }
    throw e
  }
}

/** Renames a project. */
export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)

  const auth = await currentUserOr503()
  if ("unavailable" in auth) return json({ error: "We're having trouble reaching our servers." }, 503)
  if (!auth.user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const body = await readJson(req)
  const name = str(body?.name).trim().slice(0, 120)
  if (!name) return json({ error: "Give the project a name." }, 400)

  const ok = await renameProject(projectId, auth.user.id, name)
  if (!ok) return json({ error: "Project not found." }, 404)

  return json({ ok: true, name })
}

/** Deletes a project and its uploaded assets. */
export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOrigin(req)) return json({ error: "Bad request" }, 400)

  const auth = await currentUserOr503()
  if ("unavailable" in auth) return json({ error: "We're having trouble reaching our servers." }, 503)
  if (!auth.user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const deleted = await deleteProjectForUser(projectId, auth.user.id)
  if (!deleted) return json({ error: "Project not found." }, 404)

  await deleteObjects(deleted.assetKeys).catch(() => undefined)

  return json({ ok: true })
}
