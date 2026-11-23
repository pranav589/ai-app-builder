import express, { Router } from "express"
import type { Request, Response, NextFunction } from "express"
import * as appRuntimeController from "../controllers/app-runtime.controller"

export const appRuntimeRouter = Router()

// Built apps (APK, Expo Go preview, web deploy, ZIP/GitHub export) call this from outside
// our origin, so unlike every other route it answers CORS for any origin -- deliberately,
// not an oversight: nothing here is authorized by cookies (the global cors() allowlist in
// index.ts doesn't apply), the caller proves itself with the project's x-app-key, and
// signed-in end users add their own x-app-session. Set on every response (success or
// error) since headers set here stick through to whatever later calls res.json/res.end,
// including errorHandler.
function runtimeCors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-headers", "content-type, x-app-key, x-app-session")
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
  res.setHeader("access-control-max-age", "86400")
  next()
}

appRuntimeRouter.use(runtimeCors)
// One catch-all preflight response for every route below (REST or legacy).
// Express 5's path-to-regexp no longer accepts a bare "*", so this matches by RegExp instead.
appRuntimeRouter.options(/.*/, (_req, res) => res.status(204).end())
// This router is mounted before index.ts's global cors()/cookie-parser/body-parser chain
// (so the global CORS allowlist never intercepts its cross-origin OPTIONS preflight), so
// it parses its own body instead of relying on the global express.json().
const json = express.json({ limit: "15mb" })

// Legacy: every pre-redesign exported app still calls this single endpoint.
appRuntimeRouter.post("/:projectId/data", json, appRuntimeController.postRuntimeData)

// REST routes: what a connected app's lib/api.ts actually calls (see shared/app-backend
// or docs/api-reference.md for the full list). Each maps onto the same { op, ...args }
// dispatcher (app-ops.ts) through handleRuntimeDataOp, so the app-key check, rate limit and
// declaredOnly behave identically to the legacy route above.
appRuntimeRouter.get("/:projectId/collections/:name", appRuntimeController.listCollection)
appRuntimeRouter.post("/:projectId/collections/:name", json, appRuntimeController.insertRecord)
appRuntimeRouter.get("/:projectId/collections/:name/:id", appRuntimeController.getRecord)
appRuntimeRouter.patch("/:projectId/collections/:name/:id", json, appRuntimeController.updateRecord)
appRuntimeRouter.delete("/:projectId/collections/:name/:id", appRuntimeController.removeRecord)

appRuntimeRouter.get("/:projectId/settings", appRuntimeController.getSettings)
appRuntimeRouter.put("/:projectId/settings/:key", json, appRuntimeController.putSetting)

appRuntimeRouter.post("/:projectId/auth/sign-up", json, appRuntimeController.authSignUp)
appRuntimeRouter.post("/:projectId/auth/sign-in", json, appRuntimeController.authSignIn)
appRuntimeRouter.post("/:projectId/auth/sign-out", appRuntimeController.authSignOut)
appRuntimeRouter.post("/:projectId/auth/reset-password", json, appRuntimeController.authResetPassword)
appRuntimeRouter.get("/:projectId/auth/me", appRuntimeController.authMe)

appRuntimeRouter.post("/:projectId/uploads", json, appRuntimeController.upload)
