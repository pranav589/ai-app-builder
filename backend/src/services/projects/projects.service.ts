import { and, eq } from "drizzle-orm"
import { db, projects } from "@/db"
import {
  createProjectRecord,
  deleteProjectForUser,
  duplicateProject,
  getLastMessageSender,
  getProjectForUser,
  getPublicProjectBySlug,
  listProjectsForUser,
  listPublicProjects,
  renameProject,
  setProjectVisibility,
  updateProjectTheme,
  type ProjectSummary,
  type PublicProjectSummary,
} from "@/db/projects"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { slug } from "@app/shared/app-project/scaffold"
import { buildExportFileMap, zipFileMap } from "../app-project/zip-export"
import { workspaceFromDoc } from "../verify/workspace"

export {
  listProjectsForUser,
  renameProject,
  deleteProjectForUser,
  duplicateProject,
  setProjectVisibility,
  listPublicProjects,
  getPublicProjectBySlug,
  getProjectForUser,
  getLastMessageSender,
  createProjectRecord,
  updateProjectTheme,
  type ProjectSummary,
  type PublicProjectSummary,
}

export async function getProjectExportZip(
  userId: string,
  projectId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) return null

  const doc = readAppDoc(project.previewScreens)
  const { files } = workspaceFromDoc(doc)
  const exportFiles = await buildExportFileMap(project.id, project.name, files, { selfHost: true })
  const zip = await zipFileMap(exportFiles)
  const filename = `${slug(project.name)}.zip`

  return { buffer: zip, filename }
}
