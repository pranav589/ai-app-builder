import type { Request, Response, NextFunction } from "express"
import { isConnectConfigured, parseServices } from "../services/cloudhike/config"
import { beginConnect, completeConnect, ConnectError, hasConnection, readConnectState, STATE_COOKIE } from "../services/cloudhike/connect"
import {
  disconnectBackend,
  getBackendStatus,
  handlePreviewDataOp,
} from "../services/cloudhike/cloudhike.service"

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "")

export async function connect(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.query.projectId || "")
    const services = parseServices(req.query.services as string)

    const backUrl = (q: Record<string, string>) => {
      const u = new URL(`${FRONTEND_URL}/workspace/${encodeURIComponent(projectId)}`)
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
      return u.toString()
    }

    if (!isConnectConfigured()) {
      res.redirect(303, backUrl({ backend: "error", reason: "not_configured" }))
      return
    }

    if (req.query.reconnect !== "1" && (await hasConnection(req.user!.id))) {
      res.redirect(303, backUrl({ backend: "connected", services: services.join(",") }))
      return
    }

    const { url: authorize, cookie, maxAge } = beginConnect(req.user!.id, projectId, services)
    res.cookie(STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      path: "/api/cloudhike",
      maxAge: maxAge * 1000,
    })
    res.redirect(303, authorize)
  } catch (err) {
    next(err)
  }
}

export async function callback(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[STATE_COOKIE]
    res.clearCookie(STATE_COOKIE, { path: "/api/cloudhike" })

    if (!req.user) {
      res.redirect(303, `${FRONTEND_URL}/`)
      return
    }

    const state = readConnectState(raw, String(req.query.state || ""), req.user.id)
    if (!state) {
      res.redirect(303, `${FRONTEND_URL}/?cloudhike=expired`)
      return
    }

    const backUrl = (q: Record<string, string>) => {
      const u = new URL(`${FRONTEND_URL}/workspace/${encodeURIComponent(state.p)}`)
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
      return u.toString()
    }

    if (req.query.error) {
      const reason = req.query.error === "access_denied" ? "denied" : "failed"
      res.redirect(303, backUrl({ backend: "error", reason }))
      return
    }

    const code = String(req.query.code || "")
    if (!code) {
      res.redirect(303, backUrl({ backend: "error", reason: "failed" }))
      return
    }

    try {
      await completeConnect(req.user.id, code)
    } catch (e) {
      console.error("CloudHike connect failed", e instanceof ConnectError ? e.code : e)
      const reason =
        e instanceof ConnectError && e.code === "invalid_grant"
          ? "expired"
          : e instanceof ConnectError && e.code === "invalid_client"
            ? "not_configured"
            : "failed"
      res.redirect(303, backUrl({ backend: "error", reason }))
      return
    }

    res.redirect(303, backUrl({ backend: "connected", services: state.s.join(",") }))
  } catch (err) {
    next(err)
  }
}

export async function getBackend(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const status = await getBackendStatus(req.user!.id, projectId)
    res.json(status)
  } catch (err) {
    next(err)
  }
}

export async function deleteBackend(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const forget = req.body?.forgetAccount === true
    await disconnectBackend(req.user!.id, projectId, forget)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function postBackendData(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const session = String(req.headers["x-app-session"] || "")
    const result = await handlePreviewDataOp(
      req.user!.id,
      projectId,
      req.body,
      session,
      FRONTEND_URL
    )
    res.json(result)
  } catch (err) {
    next(err)
  }
}

