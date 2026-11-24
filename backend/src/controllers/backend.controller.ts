import type { Request, Response, NextFunction } from "express"
import { parseServices } from "@app/shared/app-backend/providers"
import { beginConnectState, readConnectState, STATE_COOKIE } from "../services/app-backend/connect-state"
import { disconnectBackend, getBackendStatus, handlePreviewDataOp } from "../services/app-backend/backend.service"
import { getProvider } from "../services/app-backend/registry"
import { ConnectError } from "../services/app-backend/types"

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "")
const COOKIE_PATH = "/api/backend-providers"

/** Back to the workspace, with the outcome the Connect control reads from the query. */
const workspaceUrl = (projectId: string, q: Record<string, string>) => {
  const u = new URL(`${FRONTEND_URL}/workspace/${encodeURIComponent(projectId)}`)
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
  return u.toString()
}

export async function connect(req: Request, res: Response, next: NextFunction) {
  try {
    const provider = getProvider(req.params.provider)
    const projectId = String(req.query.projectId || "")
    const services = parseServices(provider.id, req.query.services)
    const back = (q: Record<string, string>) => workspaceUrl(projectId, { provider: provider.id, ...q })

    if (!provider.connect.isConfigured()) {
      res.redirect(303, back({ backend: "error", reason: "not_configured" }))
      return
    }

    if (req.query.reconnect !== "1" && (await provider.connect.hasConnection(req.user!.id))) {
      res.redirect(303, back({ backend: "connected", services: services.join(",") }))
      return
    }

    const { nonce, cookie, maxAge } = beginConnectState(req.user!.id, projectId, provider.id, services)
    res.cookie(STATE_COOKIE, cookie, { httpOnly: true, secure: req.secure, sameSite: "lax", path: COOKIE_PATH, maxAge: maxAge * 1000 })
    res.redirect(303, provider.connect.authorizeUrl(nonce))
  } catch (err) {
    next(err)
  }
}

export async function callback(req: Request, res: Response, next: NextFunction) {
  try {
    const provider = getProvider(req.params.provider)
    const raw = req.cookies?.[STATE_COOKIE]
    res.clearCookie(STATE_COOKIE, { path: COOKIE_PATH })

    if (!req.user) {
      res.redirect(303, `${FRONTEND_URL}/`)
      return
    }

    const state = readConnectState(raw, String(req.query.state || ""), req.user.id, provider.id)
    if (!state) {
      res.redirect(303, `${FRONTEND_URL}/?backend=expired`)
      return
    }
    const back = (q: Record<string, string>) => workspaceUrl(state.p, { provider: provider.id, ...q })

    if (req.query.error) {
      res.redirect(303, back({ backend: "error", reason: req.query.error === "access_denied" ? "denied" : "failed" }))
      return
    }

    const code = String(req.query.code || "")
    if (!code) {
      res.redirect(303, back({ backend: "error", reason: "failed" }))
      return
    }

    try {
      await provider.connect.complete(req.user.id, code)
    } catch (e) {
      console.error(`${provider.id} connect failed`, e instanceof ConnectError ? e.code : e)
      const code = e instanceof ConnectError ? e.code : ""
      const reason = code === "invalid_grant" ? "expired" : code === "invalid_client" ? "not_configured" : "failed"
      res.redirect(303, back({ backend: "error", reason }))
      return
    }

    res.redirect(303, back({ backend: "connected", services: state.s.join(",") }))
  } catch (err) {
    next(err)
  }
}

export async function getBackend(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getBackendStatus(req.user!.id, String(req.params.projectId || "")))
  } catch (err) {
    next(err)
  }
}

export async function deleteBackend(req: Request, res: Response, next: NextFunction) {
  try {
    const converted = await disconnectBackend(req.user!.id, String(req.params.projectId || ""), req.body?.forgetAccount === true)
    res.json({ ok: true, ...converted })
  } catch (err) {
    next(err)
  }
}

export async function postBackendData(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const session = String(req.headers["x-app-session"] || "")
    res.json(await handlePreviewDataOp(projectId, req.body, session, FRONTEND_URL))
  } catch (err) {
    next(err)
  }
}
