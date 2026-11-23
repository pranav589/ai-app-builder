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
  res.setHeader("access-control-allow-methods", "POST, OPTIONS")
  res.setHeader("access-control-max-age", "86400")
  next()
}

appRuntimeRouter.use(runtimeCors)
appRuntimeRouter.options("/:projectId/data", (_req, res) => res.status(204).end())
// This router is mounted before index.ts's global cors()/cookie-parser/body-parser chain
// (so the global CORS allowlist never intercepts its cross-origin OPTIONS preflight), so
// it parses its own body instead of relying on the global express.json().
appRuntimeRouter.post("/:projectId/data", express.json({ limit: "15mb" }), appRuntimeController.postRuntimeData)
