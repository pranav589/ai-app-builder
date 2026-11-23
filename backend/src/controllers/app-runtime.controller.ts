import type { Request, Response, NextFunction } from "express"
import { handleRuntimeDataOp } from "../services/app-backend/backend.service"

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "")

function requestAuth(req: Request) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip || "unknown"
  return {
    ip,
    appKey: String(req.headers["x-app-key"] || ""),
    appSession: String(req.headers["x-app-session"] || ""),
    projectId: String(req.params.projectId || ""),
  }
}

/** The legacy single endpoint every pre-redesign exported app still calls: POST /data { op, ...args }, answered as { result }. */
export async function postRuntimeData(req: Request, res: Response, next: NextFunction) {
  try {
    const { ip, appKey, appSession, projectId } = requestAuth(req)
    const result = await handleRuntimeDataOp(projectId, ip, appKey, appSession, req.body, FRONTEND_URL)
    res.setHeader("Cache-Control", "no-store")
    res.json(result)
  } catch (err) {
    next(err)
  }
}

/** Runs `toBody(req)` as a { op, ...args } call and answers with the bare result (REST style: the resource itself, not an { op } envelope). Reuses handleRuntimeDataOp for the app-key check, rate limit and declaredOnly, same as postRuntimeData above. */
function handle(toBody: (req: Request) => Record<string, unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ip, appKey, appSession, projectId } = requestAuth(req)
      const { result } = await handleRuntimeDataOp(projectId, ip, appKey, appSession, toBody(req), FRONTEND_URL)
      res.setHeader("Cache-Control", "no-store")
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
}

export const listCollection = handle((req) => ({ op: "list", collection: req.params.name }))
export const insertRecord = handle((req) => ({ op: "insert", collection: req.params.name, values: req.body }))
export const getRecord = handle((req) => ({ op: "get", collection: req.params.name, id: req.params.id }))
export const updateRecord = handle((req) => ({ op: "update", collection: req.params.name, id: req.params.id, patch: req.body }))
export const removeRecord = handle((req) => ({ op: "remove", collection: req.params.name, id: req.params.id }))

export const getSettings = handle(() => ({ op: "settings" }))
// express.json()'s default strict mode rejects a top-level scalar body, so a setting's
// value (which can be a plain string/boolean/number) travels wrapped: PUT body { value }.
export const putSetting = handle((req) => ({ op: "setSetting", key: req.params.key, value: req.body?.value }))

export const authSignUp = handle((req) => ({ op: "auth.signUp", ...req.body }))
export const authSignIn = handle((req) => ({ op: "auth.signIn", ...req.body }))
export const authSignOut = handle(() => ({ op: "auth.signOut" }))
export const authResetPassword = handle((req) => ({ op: "auth.resetPassword", ...req.body }))
export const authMe = handle(() => ({ op: "auth.current" }))

export const upload = handle((req) => ({ op: "upload", dataUrl: req.body?.dataUrl }))
