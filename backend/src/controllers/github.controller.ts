import type { Request, Response, NextFunction } from "express"
import { Readable } from "node:stream"
import { GITHUB_SCOPE, isConnectConfigured } from "../services/github/config"
import { beginConnect, completeConnect, ConnectError, getAccess, readConnectState, STATE_COOKIE } from "../services/github/connect"
import {
  getGithubConfigAndStatus,
  getProjectGithubInfo,
  listReposForUser,
  streamPushProject,
} from "../services/github/github.service"

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "")

export async function connect(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.query.projectId || "")

    const backUrl = (q: Record<string, string>) => {
      const u = new URL(`${FRONTEND_URL}/workspace/${encodeURIComponent(projectId)}`)
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
      return u.toString()
    }

    if (!isConnectConfigured()) {
      res.redirect(303, backUrl({ github: "error", reason: "not_configured" }))
      return
    }

    const isReconnect = req.query.reconnect === "1"
    const access = await getAccess(req.user!.id)
    const hasAllScopes = Boolean(access) && GITHUB_SCOPE.split(/\s+/).every((s) => access!.scope.split(/[\s,]+/).includes(s))
    if (!isReconnect && access && hasAllScopes) {
      res.redirect(303, backUrl({ github: "connected" }))
      return
    }

    const { url: authorize, cookie, maxAge } = beginConnect(req.user!.id, projectId)
    res.cookie(STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      path: "/api/github",
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
    res.clearCookie(STATE_COOKIE, { path: "/api/github" })

    if (!req.user) {
      res.redirect(303, `${FRONTEND_URL}/`)
      return
    }

    const state = readConnectState(raw, String(req.query.state || ""), req.user.id)
    if (!state) {
      res.redirect(303, `${FRONTEND_URL}/?github=expired`)
      return
    }

    const backUrl = (q: Record<string, string>) => {
      const u = new URL(`${FRONTEND_URL}/workspace/${encodeURIComponent(state.p)}`)
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
      return u.toString()
    }

    if (req.query.error) {
      const reason = req.query.error === "access_denied" ? "denied" : "failed"
      res.redirect(303, backUrl({ github: "error", reason }))
      return
    }

    const code = String(req.query.code || "")
    if (!code) {
      res.redirect(303, backUrl({ github: "error", reason: "failed" }))
      return
    }

    try {
      await completeConnect(req.user.id, code)
    } catch (e) {
      console.error("GitHub connect failed", e instanceof ConnectError ? e.code : e)
      const reason =
        e instanceof ConnectError && (e.code === "bad_verification_code" || e.code === "invalid_grant")
          ? "expired"
          : e instanceof ConnectError && (e.code === "incorrect_client_credentials" || e.code === "invalid_client")
            ? "not_configured"
            : "failed"
      res.redirect(303, backUrl({ github: "error", reason }))
      return
    }

    res.redirect(303, backUrl({ github: "connected" }))
  } catch (err) {
    next(err)
  }
}

export async function status(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getGithubConfigAndStatus(req.user?.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function repos(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await listReposForUser(req.user!.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getLink(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await getProjectGithubInfo(req.user!.id, projectId)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function push(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const controller = new AbortController()
    req.on("close", () => controller.abort())

    const stream = await streamPushProject(req.user!.id, projectId, req.body, controller.signal)

    res.setHeader("content-type", "text/event-stream; charset=utf-8")
    res.setHeader("cache-control", "no-store, no-transform")
    res.setHeader("connection", "keep-alive")
    res.setHeader("x-accel-buffering", "no")

    const nodeStream = Readable.fromWeb(stream as import("node:stream/web").ReadableStream)
    nodeStream.pipe(res)
    req.on("close", () => {
      nodeStream.destroy()
    })
  } catch (err) {
    next(err)
  }
}

