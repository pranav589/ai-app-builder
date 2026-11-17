import { NextResponse } from "next/server"

import { isConnectConfigured, parseServices } from "@/lib/cloudhike/config"
import { beginConnect, hasConnection, STATE_COOKIE } from "@/lib/cloudhike/connect"
import { requireOwnedProject } from "@/lib/cloudhike/owner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Starts "Connect to CloudHike" for one app. Already connected: straight back
 * to the workspace, which then sets up the backend. Otherwise the browser goes
 * to CloudHike's Allow screen, with a signed cookie that pins the flow to
 * this user and app.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get("projectId") ?? ""
  const services = parseServices(url.searchParams.get("services"))
  const back = (q: Record<string, string>) => {
    const to = new URL(`/workspace/${encodeURIComponent(projectId)}`, url.origin)
    for (const [k, v] of Object.entries(q)) to.searchParams.set(k, v)
    return NextResponse.redirect(to, { status: 303 })
  }

  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error.status === 401 ? NextResponse.redirect(new URL("/", url.origin), { status: 303 }) : owned.error
  if (!isConnectConfigured()) return back({ backend: "error", reason: "not_configured" })

  if (url.searchParams.get("reconnect") !== "1" && (await hasConnection(owned.user.id)))
    return back({ backend: "connected", services: services.join(",") })

  const { url: authorize, cookie, maxAge } = beginConnect(owned.user.id, projectId, services)
  const res = NextResponse.redirect(authorize, { status: 303 })
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/cloudhike",
    maxAge,
  })
  return res
}
