import type { Request, Response, NextFunction } from "express"
import { getProjectExportZip } from "../services/projects/projects.service"

export async function exportZip(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const result = await getProjectExportZip(req.user!.id, projectId)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }

    res.setHeader("content-type", "application/zip")
    res.setHeader("content-disposition", `attachment; filename="${result.filename}"`)
    res.setHeader("cache-control", "no-store")
    res.send(result.buffer)
  } catch (err) {
    next(err)
  }
}

