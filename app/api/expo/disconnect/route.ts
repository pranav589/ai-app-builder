import { getCurrentUser } from "@/lib/current-user"
import { isSameOriginJson, json } from "@/lib/http"
import { forgetConnection } from "@/lib/publish/expo-connect"

export const runtime = "nodejs"

export async function POST(req: Request) {
  if (!isSameOriginJson(req)) {
    return json({ error: "Invalid request origin or content type." }, 400)
  }

  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    return json({ error: "Unauthorized" }, 401)
  }

  await forgetConnection(user.id)
  return json({ ok: true })
}
