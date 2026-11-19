import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"
import {
  buildTransformedUrl,
  parsePromptToTransformations,
  type ImageKitTransformOptions,
} from "@/lib/imagekit"

export const runtime = "nodejs"

/**
 * Applies ImageKit AI transformations to an existing or new image URL based on a user prompt or options.
 */
export async function POST(req: Request) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) {
      return json({ error: "We're having trouble reaching our servers." }, 503)
    }
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const body = await readJson(req)
  const imageUrl = str(body?.imageUrl)
  if (!imageUrl) return json({ error: "imageUrl is required" }, 400)

  const prompt = str(body?.prompt) || ""
  const options = (body?.options || {}) as ImageKitTransformOptions

  try {
    const appliedTransformations = prompt
      ? parsePromptToTransformations(prompt)
      : []

    const transformedUrl = buildTransformedUrl(imageUrl, {
      ...options,
      prompt: prompt || options.prompt,
    })

    return json({
      ok: true,
      transformedUrl,
      appliedTransformations,
    })
  } catch (e) {
    console.error("ImageKit transform error:", e)
    return json({ error: "Failed to apply image transformation" }, 500)
  }
}
