import { duplicateProject } from "@/db/projects"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOrigin, json } from "@/lib/http"

export const runtime = "nodejs"

/** Clones a project the caller owns into a new, private project. */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOrigin(req)) return json({ error: "Bad request" }, 400)

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return json({ error: "We're having trouble reaching our servers." }, 503)
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const copy = await duplicateProject(projectId, user.id)
  if (!copy) return json({ error: "Project not found." }, 404)

  return json({ project: copy })
}
