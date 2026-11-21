import type { Request, Response, NextFunction } from "express"
import { ServiceUnavailableError } from "../services/current-user"
import { AppBackendError } from "../services/cloudhike/app-data"

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err)
  }

  if (err instanceof ServiceUnavailableError) {
    res.status(503).json({ error: err.message || "Service unavailable" })
    return
  }

  if (err instanceof AppBackendError) {
    res.status(err.status || 400).json({ error: err.message })
    return
  }

  const anyErr = err as Record<string, unknown>
  if (typeof anyErr?.status === "number" && anyErr.status >= 400 && anyErr.status < 600) {
    // Errors carrying a machine-readable code keep the { error: code, message } shape the
    // UI and API clients had before the split; plain ones answer { error: message }.
    if (typeof anyErr.code === "string") {
      res.status(anyErr.status).json({ error: anyErr.code, message: String(anyErr.message || "Error") })
      return
    }
    res.status(anyErr.status).json({ error: String(anyErr.message || "Error") })
    return
  }

  // Never echo an unexpected failure's message: it can carry database or credential details.
  console.error("Unhandled error:", err)
  res.status(500).json({ error: "Internal Server Error" })
}
