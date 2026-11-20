import { getCurrentUser } from "@/lib/current-user"
import { isSameOriginJson, json, readJson } from "@/lib/http"
import { ExpoConnectError, saveToken } from "@/lib/publish/expo-connect"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!isSameOriginJson(req)) {
    return json({ error: "Invalid request origin or content type." }, 400)
  }

  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    return json({ error: "Unauthorized" }, 401)
  }

  const body = await readJson(req)
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!token) {
    return json({ error: "missing_token", message: "Expo token is required." }, 400)
  }

  try {
    const { username } = await saveToken(user.id, token)
    return json({ ok: true, username })
  } catch (err) {
    if (err instanceof ExpoConnectError) {
      return json({ error: err.code, message: err.message }, 400)
    }
    return json({ error: "connect_failed", message: "Failed to connect Expo account." }, 500)
  }
}
