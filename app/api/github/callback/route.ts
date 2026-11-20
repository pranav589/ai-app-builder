import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { completeConnect, ConnectError, readConnectState, STATE_COOKIE } from "@/lib/github/connect"
import { getCurrentUser } from "@/lib/current-user"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const jar = await cookies()
  const raw = jar.get(STATE_COOKIE)?.value
  jar.delete({ name: STATE_COOKIE, path: "/api/github" })

  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.redirect(new URL("/", url.origin), { status: 303 })

  const state = readConnectState(raw, url.searchParams.get("state"), user.id)
  if (!state) return NextResponse.redirect(new URL("/?github=expired", url.origin), { status: 303 })

  const back = (q: Record<string, string>) => {
    const to = new URL(`/workspace/${encodeURIComponent(state.p)}`, url.origin)
    for (const [k, v] of Object.entries(q)) to.searchParams.set(k, v)
    return NextResponse.redirect(to, { status: 303 })
  }

  if (url.searchParams.get("error")) {
    return back({
      github: "error",
      reason: url.searchParams.get("error") === "access_denied" ? "denied" : "failed",
    })
  }

  const code = url.searchParams.get("code")
  if (!code) return back({ github: "error", reason: "failed" })

  try {
    await completeConnect(user.id, code)
  } catch (e) {
    console.error("GitHub connect failed", e instanceof ConnectError ? e.code : e)
    const reason =
      e instanceof ConnectError && (e.code === "bad_verification_code" || e.code === "invalid_grant")
        ? "expired"
        : e instanceof ConnectError && (e.code === "incorrect_client_credentials" || e.code === "invalid_client")
          ? "not_configured"
          : "failed"
    return back({ github: "error", reason })
  }

  return back({ github: "connected" })
}
