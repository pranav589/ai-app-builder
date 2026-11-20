import { getCurrentUser } from "@/lib/current-user"
import { json } from "@/lib/http"
import { getConnection } from "@/lib/publish/expo-connect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    return json({ connected: false })
  }

  const conn = await getConnection(user.id)
  return json({
    connected: Boolean(conn),
    username: conn?.expoUsername || null,
  })
}
