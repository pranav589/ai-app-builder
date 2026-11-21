import type { Request, Response, NextFunction } from "express"
import { CloudHikeAuthError, getSessionUser, signInEmail, signOutToken, signUpEmail } from "../services/cloudhike-auth"
import { extractToken } from "../middleware/requireUser"
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "../services/session"
import { ensureUser } from "../services/users"
import { validateCredentials } from "@app/shared/auth-validation"

export async function getSession(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) {
    res.json({ user: null })
    return
  }

  try {
    const authUser = await getSessionUser(token)
    if (!authUser) {
      res.clearCookie(SESSION_COOKIE, { path: "/" })
      res.json({ user: null })
      return
    }
    const user = await ensureUser(authUser)
    res.json({ user })
  } catch (err) {
    console.error("session lookup failed", err)
    res.status(503).json({ user: null })
  }
}

export async function signIn(req: Request, res: Response, next: NextFunction) {
  const body = req.body || {}
  const input = {
    email: String(body.email || "").trim().toLowerCase(),
    password: String(body.password || ""),
  }
  const fieldErrors = validateCredentials("sign-in", input)
  if (Object.keys(fieldErrors).length) {
    res.status(400).json({ error: "Check the highlighted fields", fieldErrors })
    return
  }

  try {
    const { token, user: authUser } = await signInEmail(input)
    const user = await ensureUser(authUser)
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
    res.json({ user })
  } catch (err) {
    if (err instanceof CloudHikeAuthError) {
      res.status(err.status === 503 ? 503 : err.status < 500 ? err.status : 502).json({
        error: err.message,
        code: err.code,
      })
      return
    }
    console.error("sign-in failed", err)
    res.status(500).json({ error: "Something went wrong. Try again." })
  }
}

export async function signUp(req: Request, res: Response, next: NextFunction) {
  const body = req.body || {}
  const input = {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    password: String(body.password || ""),
  }
  const fieldErrors = validateCredentials("sign-up", input)
  if (Object.keys(fieldErrors).length) {
    res.status(400).json({ error: "Check the highlighted fields", fieldErrors })
    return
  }

  try {
    const { token, user: authUser } = await signUpEmail(input)
    let user
    try {
      user = await ensureUser(authUser)
    } catch (e) {
      console.error("sign-up: account created but user record failed", e)
      res.status(500).json({
        error: "Your account was created, but we couldn't finish setting it up. Please sign in.",
      })
      return
    }
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
    res.json({ user })
  } catch (err) {
    if (err instanceof CloudHikeAuthError) {
      res.status(err.status === 503 ? 503 : err.status < 500 ? err.status : 502).json({
        error: err.message,
        code: err.code,
      })
      return
    }
    console.error("sign-up failed", err)
    res.status(500).json({ error: "Something went wrong. Try again." })
  }
}

export async function signOut(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (token) {
    await signOutToken(token).catch(() => undefined)
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" })
  res.json({ ok: true })
}

export async function social(req: Request, res: Response, next: NextFunction) {
  const token = String(req.body?.token || "")
  if (!token || token.length > 4096) {
    res.status(400).json({ error: "Bad request" })
    return
  }

  try {
    const authUser = await getSessionUser(token)
    if (!authUser) {
      res.status(401).json({ error: "Sign-in expired. Try again." })
      return
    }
    const user = await ensureUser(authUser)
    res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)
    res.json({ user })
  } catch (err) {
    if (err instanceof CloudHikeAuthError) {
      res.status(err.status === 503 ? 503 : err.status < 500 ? err.status : 502).json({
        error: err.message,
      })
      return
    }
    console.error("social sign-in failed", err)
    res.status(500).json({ error: "Something went wrong. Try again." })
  }
}
