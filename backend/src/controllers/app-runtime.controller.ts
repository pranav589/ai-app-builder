import type { Request, Response, NextFunction } from "express"
import { handleRuntimeDataOp } from "../services/app-backend/backend.service"

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "")

export async function postRuntimeData(req: Request, res: Response, next: NextFunction) {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown"
    const appKey = String(req.headers["x-app-key"] || "")
    const appSession = String(req.headers["x-app-session"] || "")
    const projectId = String(req.params.projectId || "")

    const result = await handleRuntimeDataOp(
      projectId,
      ip,
      appKey,
      appSession,
      req.body,
      FRONTEND_URL
    )

    res.setHeader("Cache-Control", "no-store")
    res.json(result)
  } catch (err) {
    next(err)
  }
}

