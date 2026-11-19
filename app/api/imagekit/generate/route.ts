import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"
import { generateAiImage } from "@/lib/imagekit"

export const runtime = "nodejs"

/**
 * Generates an AI image based on user prompt and hosts/manages it with ImageKit.
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
  const prompt = str(body?.prompt)
  if (!prompt) return json({ error: "Prompt is required" }, 400)

  const style = str(body?.style) || undefined

  try {
    const result = await generateAiImage(prompt, style)
    return json({
      ok: true,
      imageUrl: result.url,
      prompt: result.prompt,
    })
  } catch (e) {
    console.error("ImageKit AI image generation failed:", e)
    return json({ error: "Failed to generate AI image" }, 500)
  }
}
