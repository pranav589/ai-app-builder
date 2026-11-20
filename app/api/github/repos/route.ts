import { getCurrentUser } from "@/lib/current-user"
import { GithubApiError, listRepos } from "@/lib/github/api"
import { getAccess, markRevoked } from "@/lib/github/connect"
import { json } from "@/lib/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const access = await getAccess(user.id)
  if (!access) return json({ error: "reconnect" }, 401)

  try {
    const repos = await listRepos(access.token)
    return json({ repos })
  } catch (err) {
    if (err instanceof GithubApiError && (err.status === 401 || err.code === "auth_expired")) {
      await markRevoked(user.id)
      return json({ error: "reconnect" }, 401)
    }
    if (err instanceof GithubApiError && err.code === "rate_limited") {
      return json({ error: "rate_limited", message: err.message }, 403)
    }
    console.error("Failed to list GitHub repos", err)
    return json({ error: "failed", message: err instanceof Error ? err.message : "Unknown error" }, 500)
  }
}
