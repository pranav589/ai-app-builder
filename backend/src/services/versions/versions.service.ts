import { and, eq } from "drizzle-orm"
import { db, projects } from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { getSnapshot, listSnapshots, restoreSnapshot } from "./store"
import { diffWorkspaces } from "./diff"
import { workspaceFromDoc } from "../verify/workspace"
import { activeRun } from "../agent/run-store"

export class VersionNotFoundError extends Error {
  status = 404
}

export class VersionConflictError extends Error {
  status = 409
}

export async function listProjectVersions(userId: string, projectId: string) {
  const [project] = await db
    .select({ id: projects.id, currentVersion: projects.currentVersion })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) return null

  const rows = await listSnapshots(projectId)
  return {
    current: project.currentVersion,
    versions: rows.map((r) => ({
      version: r.version,
      intent: r.intent,
      author: r.author,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

export async function diffProjectVersion(userId: string, projectId: string, version: number) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) return null

  const snap = await getSnapshot(projectId, version)
  if (!snap) throw new VersionNotFoundError("That version doesn't exist.")

  const after = workspaceFromDoc(readAppDoc(snap.doc)).files
  const before = snap.parentVersion
    ? workspaceFromDoc(readAppDoc((await getSnapshot(projectId, snap.parentVersion))?.doc)).files
    : {}
  const files = diffWorkspaces(before, after)

  return { version, parentVersion: snap.parentVersion, intent: snap.intent, files }
}

export async function restoreProjectVersion(userId: string, projectId: string, version: number) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) return null

  if (await activeRun(projectId)) {
    throw new VersionConflictError("The agent is working on this project right now. Wait for it to finish, then restore.")
  }

  const result = await restoreSnapshot(projectId, version, { author: userId })
  if (!result) throw new VersionNotFoundError("That version doesn't exist.")

  return { version: result.version }
}
