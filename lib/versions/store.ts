import "server-only"
import { randomBytes } from "node:crypto"
import { and, desc, eq, inArray } from "drizzle-orm"

import { appSnapshots, db, projects } from "@/db"
import { readAppDoc, type AppDoc } from "@/lib/app-runtime/app-doc"
import { selectPrune, versionsToCommit } from "./plan"

const newId = () => `snap-${Date.now()}-${randomBytes(4).toString("hex")}`

/** Snapshots kept per project; older ones are pruned on commit. */
const KEEP = 50

export type CommitOpts = {
  /** Who made the change: a user id, or null/omitted for the system. */
  author?: string | null
  intent: string
  runId?: string | null
}

/**
 * Writes a new version of the project's app document: inserts a snapshot,
 * advances projects.current_version, and writes preview_screens, all in one
 * transaction. A legacy project (current_version still 0, but with an
 * existing doc) first gets that doc committed as version 1.
 */
export async function commitSnapshot(projectId: string, doc: AppDoc, opts: CommitOpts): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ currentVersion: projects.currentVersion, previewScreens: projects.previewScreens, userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) throw new Error("project not found")

    const existing = readAppDoc(project.previewScreens)
    const plan = versionsToCommit(project.currentVersion, existing.screens.length > 0)

    if (plan.initial) {
      await tx.insert(appSnapshots).values({
        id: newId(),
        projectId,
        version: plan.initial,
        parentVersion: null,
        doc: existing,
        author: project.userId,
        intent: "Initial version",
        runId: null,
      })
    }

    await tx.insert(appSnapshots).values({
      id: newId(),
      projectId,
      version: plan.next,
      parentVersion: plan.parent,
      doc,
      author: opts.author ?? project.userId,
      intent: opts.intent,
      runId: opts.runId ?? null,
    })

    await tx
      .update(projects)
      .set({ currentVersion: plan.next, previewScreens: doc, updatedAt: new Date() })
      .where(eq(projects.id, projectId))

    const rows = await tx.select({ id: appSnapshots.id, version: appSnapshots.version }).from(appSnapshots).where(eq(appSnapshots.projectId, projectId))
    const pruneVersions = new Set(selectPrune(rows.map((r) => r.version), KEEP))
    const pruneIds = rows.filter((r) => pruneVersions.has(r.version)).map((r) => r.id)
    if (pruneIds.length) await tx.delete(appSnapshots).where(inArray(appSnapshots.id, pruneIds))

    return { version: plan.next }
  })
}

export async function listSnapshots(projectId: string) {
  return db
    .select({ version: appSnapshots.version, intent: appSnapshots.intent, author: appSnapshots.author, createdAt: appSnapshots.createdAt })
    .from(appSnapshots)
    .where(eq(appSnapshots.projectId, projectId))
    .orderBy(desc(appSnapshots.version))
}

export async function getSnapshot(projectId: string, version: number) {
  const [row] = await db
    .select()
    .from(appSnapshots)
    .where(and(eq(appSnapshots.projectId, projectId), eq(appSnapshots.version, version)))
    .limit(1)
  return row ?? null
}

/** Copies an older version's doc back onto the head, as a new version on top (history is never rewritten). */
export async function restoreSnapshot(projectId: string, version: number, opts: { author?: string | null } = {}) {
  const snap = await getSnapshot(projectId, version)
  if (!snap) return null
  const doc = readAppDoc(snap.doc)
  return commitSnapshot(projectId, doc, { author: opts.author, intent: `Restored version ${version}` })
}
