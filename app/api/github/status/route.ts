import { getCurrentUser } from "@/lib/current-user"
import { isConnectConfigured } from "@/lib/github/config"
import { getConnection } from "@/lib/github/connect"
import { json } from "@/lib/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const configured = isConnectConfigured()
  if (!configured) {
    return json({ configured: false, connected: false })
  }

  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    return json({ configured: true, connected: false })
  }

  const conn = await getConnection(user.id)
  return json({
    configured: true,
    connected: Boolean(conn),
    login: conn?.login,
  })
}
