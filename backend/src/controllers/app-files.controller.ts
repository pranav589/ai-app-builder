import type { Request, Response, NextFunction } from "express"
import { handleServeAppFile } from "../services/app-backend/backend.service"
import { AppBackendError } from "../services/app-backend/contract"

export async function getAppFile(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    // Express 5's "{*key}" wildcard hands back an ARRAY of path segments (not a joined
    // string, and not req.params[0] -- that was an Express 4-ism that no longer applies).
    const keyParam = (req.params as Record<string, string | string[]>).key
    const fileKey = Array.isArray(keyParam) ? keyParam.join("/") : String(keyParam || "")
    if (!fileKey) {
      res.status(404).send("Not found")
      return
    }

    const file = await handleServeAppFile(projectId, fileKey)

    res.setHeader("content-type", file.type)
    res.setHeader("cache-control", "private, max-age=86400, immutable")
    res.setHeader("x-content-type-options", "nosniff")
    res.setHeader("content-security-policy", "default-src 'none'; sandbox")
    if (file.type !== "application/pdf") {
      res.setHeader("content-disposition", "inline")
    }

    res.send(Buffer.from(file.body))
  } catch (err) {
    if (err instanceof AppBackendError) {
      res.status(err.status === 404 ? 404 : 409).send("Not found")
      return
    }
    const status = (err as Record<string, unknown>)?.status
    if (typeof status === "number") {
      res.status(status).send(String((err as Error).message || "Not found"))
      return
    }
    console.error("serving app file failed", req.params.projectId, err)
    res.status(503).send("Unavailable")
  }
}

