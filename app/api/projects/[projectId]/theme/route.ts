import { getProjectForUser, updateProjectTheme } from "@/db/projects"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"

export const runtime = "nodejs"

/**
 * Switches the app's active theme. Only the theme id changes: screens use
 * CSS variables, so the browser swaps token values and nothing is rebuilt.
 */
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
  const themeId = str(body?.themeId)
  if (!themeId) return json({ error: "Bad request" }, 400)

  const project = await getProjectForUser(projectId, user.id)
  if (!project) return json({ error: "Project not found." }, 404)

  const doc = readAppDoc(project.previewScreens)
  const targetTheme = doc.themes?.themes.find((t) => t.id === themeId)
  if (!targetTheme) return json({ error: "That theme doesn't exist." }, 404)

  // Touch only themes.activeId, so a build writing screens at the same time isn't overwritten.
  await updateProjectTheme(projectId, user.id, themeId, targetTheme.colors.primary)

  return json({ ok: true, themeId })
}
