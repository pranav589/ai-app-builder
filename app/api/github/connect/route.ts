import { NextResponse } from "next/server"

import { isConnectConfigured, GITHUB_SCOPE } from "@/lib/github/config"
import { beginConnect, getAccess, STATE_COOKIE } from "@/lib/github/connect"
import { requireOwnedProject } from "@/lib/cloudhike/owner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get("projectId") ?? ""
  const back = (q: Record<string, string>) => {
    const to = new URL(`/workspace/${encodeURIComponent(projectId)}`, url.origin)
    for (const [k, v] of Object.entries(q)) to.searchParams.set(k, v)
    return NextResponse.redirect(to, { status: 303 })
  }

  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error.status === 401 ? NextResponse.redirect(new URL("/", url.origin), { status: 303 }) : owned.error
  if (!isConnectConfigured()) return back({ github: "error", reason: "not_configured" })

  const isReconnect = url.searchParams.get("reconnect") === "1"
  const access = await getAccess(owned.user.id)
  const hasAllScopes =
    Boolean(access) &&
    GITHUB_SCOPE.split(/\s+/).every((s) => access!.scope.split(/[\s,]+/).includes(s))

  if (!isReconnect && access && hasAllScopes) {
    return back({ github: "connected" })
  }

  const { url: authorize, cookie, maxAge } = beginConnect(owned.user.id, projectId)
  const res = NextResponse.redirect(authorize, { status: 303 })
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/github",
    maxAge,
  })
  return res
}
