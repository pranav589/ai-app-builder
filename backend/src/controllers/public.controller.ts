import type { Request, Response, NextFunction } from "express"
import { getPublicProjectBySlug, listPublicProjects } from "../services/projects/projects.service"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const projects = await listPublicProjects()
    res.json({ projects })
  } catch (err) {
    next(err)
  }
}

export async function getBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = String(req.params.slug || "")
    const project = await getPublicProjectBySlug(slug)
    if (!project) {
      res.status(404).json({ error: "This app isn't available." })
      return
    }

    const doc = readAppDoc(project.previewScreens)
    res.json({
      id: project.id,
      name: project.name,
      themeColor: project.themeColor,
      screens: doc.screens,
      themes: doc.themes ?? null,
      dataModel: doc.data ?? null,
      files: doc.files ?? {},
    })
  } catch (err) {
    next(err)
  }
}

