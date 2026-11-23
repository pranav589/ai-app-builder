import type { Request, Response, NextFunction } from "express"
import { getCurrentUser } from "../services/current-user"
import { SESSION_COOKIE } from "../services/session"
import type { PublicUser } from "../services/users"

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser
      token?: string
      rawBody?: Buffer
    }
  }
}

export function extractToken(req: Request): string | null {
  const cookie = req.cookies?.[SESSION_COOKIE]
  if (cookie) return cookie

  const auth = req.headers.authorization
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim()
  }
  return null
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req)
    if (!token) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }
    const user = await getCurrentUser(token)
    if (!user) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }
    req.user = user
    req.token = token
    next()
  } catch (err) {
    next(err)
  }
}

export async function optionalUser(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req)
    if (token) {
      const user = await getCurrentUser(token)
      if (user) {
        req.user = user
        req.token = token
      }
    }
    next()
  } catch (err) {
    next(err)
  }
}
