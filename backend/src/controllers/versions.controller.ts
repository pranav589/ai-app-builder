import type { Request, Response, NextFunction } from "express"
import {
  diffProjectVersion,
  listProjectVersions,
  restoreProjectVersion,
} from "../services/versions/versions.service"

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await listProjectVersions(req.user!.id, projectId)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function diff(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const v = Number(req.params.version)
    if (!Number.isInteger(v) || v < 1) {
      res.status(400).json({ error: "Bad request" })
      return
    }

    const result = await diffProjectVersion(req.user!.id, projectId, v)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const v = Number(req.params.version)
    if (!Number.isInteger(v) || v < 1) {
      res.status(400).json({ error: "Bad request" })
      return
    }

    const result = await restoreProjectVersion(req.user!.id, projectId, v)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
}

