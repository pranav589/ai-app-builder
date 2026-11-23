import type { Request, Response, NextFunction } from "express"
import {
  deleteProjectForUser,
  duplicateProject,
  listProjectsForUser,
  renameProject,
  setProjectVisibility,
} from "../services/projects/projects.service"
import { createProject } from "../services/projects/create-project"
import { getWorkspaceData } from "../services/projects/workspace.service"
import { deleteObjects } from "../services/storage"
import { MAX_TOTAL_BYTES } from "@app/shared/project-rules"

function publicUrl(slug: string | null) {
  if (!slug) return null
  const base = (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  return `${base}/p/${slug}`
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const projects = await listProjectsForUser(req.user!.id)
    res.json({ projects })
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const contentLength = Number(req.headers["content-length"] ?? 0)
    if (contentLength > MAX_TOTAL_BYTES + 1024 * 1024) {
      res.status(413).json({ error: "Those files are too large to upload together." })
      return
    }

    const prompt = String(req.body.prompt || "")
    const rawFiles = (req.files as Express.Multer.File[]) || []

    const files = rawFiles.map((f) => ({
      name: f.originalname,
      size: f.size,
      type: f.mimetype,
      arrayBuffer: async () => f.buffer.buffer.slice(f.buffer.byteOffset, f.buffer.byteOffset + f.buffer.byteLength),
    })) as unknown as File[]

    const result = await createProject(req.user!.id, { prompt, files })
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }

    res.json({ projectId: result.projectId })
  } catch (err) {
    next(err)
  }
}

export async function rename(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 120)
    if (!name) {
      res.status(400).json({ error: "Give the project a name." })
      return
    }

    const projectId = String(req.params.projectId || "")
    const ok = await renameProject(projectId, req.user!.id, name)
    if (!ok) {
      res.status(404).json({ error: "Project not found." })
      return
    }

    res.json({ ok: true, name })
  } catch (err) {
    next(err)
  }
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const deleted = await deleteProjectForUser(projectId, req.user!.id)
    if (!deleted) {
      res.status(404).json({ error: "Project not found." })
      return
    }

    await deleteObjects(deleted.assetKeys).catch(() => undefined)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function duplicate(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const copy = await duplicateProject(projectId, req.user!.id)
    if (!copy) {
      res.status(404).json({ error: "Project not found." })
      return
    }

    res.json({ project: copy })
  } catch (err) {
    next(err)
  }
}

export async function setVisibility(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const isPublic = Boolean(req.body?.isPublic)
    const result = await setProjectVisibility(projectId, req.user!.id, isPublic)
    if (!result) {
      res.status(404).json({ error: "Project not found." })
      return
    }

    res.json({
      isPublic: result.isPublic,
      publicSlug: result.publicSlug,
      publicUrl: publicUrl(result.publicSlug),
    })
  } catch (err) {
    next(err)
  }
}

export async function getWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = String(req.params.projectId || "")
    const data = await getWorkspaceData(req.user!.id, projectId)
    if (!data) {
      res.status(404).json({ error: "Project not found." })
      return
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
}

