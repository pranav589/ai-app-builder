import type { Request, Response, NextFunction } from "express"
import { getProjectForUser } from "@/db/projects"

declare global {
  namespace Express {
    interface Request {
      /** Set by requireProjectOwner once the project is confirmed to belong to req.user. */
      project?: { id: string; status: string | null; previewScreens: unknown }
    }
  }
}

/**
 * Confirms the signed-in user owns the project named by req.params.projectId or
 * req.query.projectId (in that order), 404-ing otherwise -- the Express equivalent of the
 * old lib/cloudhike/owner.ts::requireOwnedProject (pre-Express). Must run after requireUser.
 */
export async function requireProjectOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || req.query.projectId || "")
    if (!projectId) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    const project = await getProjectForUser(projectId, req.user!.id)
    if (!project) {
      res.status(404).json({ error: "Project not found." })
      return
    }
    req.project = project
    next()
  } catch (err) {
    next(err)
  }
}
