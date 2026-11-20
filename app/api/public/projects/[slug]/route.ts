import { getPublicProjectBySlug } from "@/db/projects"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { json } from "@/lib/http"

export const runtime = "nodejs"

/**
 * Public, unauthenticated preview payload for a project the owner has made
 * public. Only ever returns the public-safe fields a visitor's sandboxed
 * preview needs — never assets, prompt, or the owner's user id.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await getPublicProjectBySlug(slug)
  if (!project) return json({ error: "This app isn't available." }, 404)

  const doc = readAppDoc(project.previewScreens)

  return json({
    id: project.id,
    name: project.name,
    themeColor: project.themeColor,
    screens: doc.screens,
    themes: doc.themes ?? null,
    dataModel: doc.data ?? null,
    files: doc.files ?? {},
  })
}
