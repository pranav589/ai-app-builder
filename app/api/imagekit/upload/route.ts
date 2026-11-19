import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { json, str } from "@/lib/http"
import { uploadToImageKit } from "@/lib/imagekit"

export const runtime = "nodejs"

/**
 * Uploads an image (URL, base64 data, or file) to ImageKit.
 */
export async function POST(req: Request) {
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

  const contentType = req.headers.get("content-type") || ""

  try {
    if (contentType.includes("application/json")) {
      const body = await req.json()
      const file = str(body?.file)
      if (!file) return json({ error: "File data or URL is required" }, 400)
      const fileName = str(body?.fileName) || undefined

      const result = await uploadToImageKit({
        file,
        fileName,
        folder: "/appforge/user-uploads",
        tags: ["appforge", "user-upload"],
      })

      return json({ ok: true, url: result.url, fileId: result.fileId, name: result.name })
    }

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData()
      const file = formData.get("file")
      if (!file || !(file instanceof Blob)) {
        return json({ error: "File is required" }, 400)
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const fileName = file.name || `upload_${Date.now()}.jpg`

      const result = await uploadToImageKit({
        file: buffer,
        fileName,
        folder: "/appforge/user-uploads",
        tags: ["appforge", "user-upload"],
      })

      return json({ ok: true, url: result.url, fileId: result.fileId, name: result.name })
    }

    return json({ error: "Unsupported content type" }, 400)
  } catch (e) {
    console.error("ImageKit upload error:", e)
    return json({ error: "Failed to upload image to ImageKit" }, 500)
  }
}
