import { setProjectVisibility } from "@/db/projects"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson } from "@/lib/http"

export const runtime = "nodejs"

function publicUrl(slug: string | null) {
  if (!slug) return null
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  return `${base}/p/${slug}`
}

/** Turns public sharing on or off for a project. */
export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
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
  const isPublic = Boolean(body?.isPublic)

  const result = await setProjectVisibility(projectId, user.id, isPublic)
  if (!result) return json({ error: "Project not found." }, 404)

  return json({ isPublic: result.isPublic, publicSlug: result.publicSlug, publicUrl: publicUrl(result.publicSlug) })
}
