import { and, desc, eq, inArray } from "drizzle-orm"
import {
  builds,
  db,
  type BuildFormat,
  type BuildPlatform,
  type BuildRow,
  type BuildStatus,
  type NewBuildRow,
} from "@/db"

export async function createQueuedBuild(data: {
  id: string
  projectId: string
  userId: string
  platform: BuildPlatform
  format: BuildFormat
  version: string
  repoOwner?: string | null
  repoName?: string | null
}): Promise<BuildRow> {
  const [created] = await db
    .insert(builds)
    .values({
      id: data.id,
      projectId: data.projectId,
      userId: data.userId,
      platform: data.platform,
      format: data.format,
      version: data.version,
      status: "queued",
      repoOwner: data.repoOwner,
      repoName: data.repoName,
      needsIosCredentials: 0,
    })
    .returning()

  return created
}

export async function getBuild(buildId: string): Promise<BuildRow | null> {
  const [row] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1)
  return row || null
}

export async function listBuildsForProject(projectId: string): Promise<BuildRow[]> {
  return db
    .select()
    .from(builds)
    .where(eq(builds.projectId, projectId))
    .orderBy(desc(builds.createdAt))
}

export async function getActiveBuildForTarget(
  projectId: string,
  platform: BuildPlatform,
  format: BuildFormat
): Promise<BuildRow | null> {
  const [active] = await db
    .select()
    .from(builds)
    .where(
      and(
        eq(builds.projectId, projectId),
        eq(builds.platform, platform),
        eq(builds.format, format),
        inArray(builds.status, ["queued", "dispatching", "building"])
      )
    )
    .limit(1)

  return active || null
}

export async function markDispatched(
  buildId: string,
  opts: {
    workflowRunId?: string | null
    workflowRunUrl?: string | null
  }
): Promise<void> {
  const [existing] = await db.select().from(builds).where(eq(builds.id, buildId)).limit(1)
  if (!existing) return

  const values: Partial<NewBuildRow> = {}
  if (existing.status === "queued") {
    values.status = "dispatching"
    values.dispatchedAt = new Date()
  }
  if (opts.workflowRunId !== undefined) values.workflowRunId = opts.workflowRunId
  if (opts.workflowRunUrl !== undefined) values.workflowRunUrl = opts.workflowRunUrl

  if (Object.keys(values).length > 0) {
    await db.update(builds).set(values).where(eq(builds.id, buildId))
  }
}

export async function markBuilding(
  buildId: string,
  opts: {
    easBuildId?: string | null
  } = {}
): Promise<void> {
  const values: Partial<NewBuildRow> = {
    status: "building",
  }
  if (opts.easBuildId) values.easBuildId = opts.easBuildId

  await db.update(builds).set(values).where(eq(builds.id, buildId))
}

export async function markReady(
  buildId: string,
  opts: {
    artifactUrl: string
    easBuildId?: string | null
    workflowRunUrl?: string | null
  }
): Promise<void> {
  const values: Partial<NewBuildRow> = {
    status: "ready",
    artifactUrl: opts.artifactUrl,
    finishedAt: new Date(),
  }
  if (opts.easBuildId) values.easBuildId = opts.easBuildId
  if (opts.workflowRunUrl) values.workflowRunUrl = opts.workflowRunUrl

  await db.update(builds).set(values).where(eq(builds.id, buildId))
}

export async function markFailed(
  buildId: string,
  opts: {
    error: string
    needsIosCredentials?: number
    easBuildId?: string | null
    workflowRunUrl?: string | null
  }
): Promise<void> {
  const values: Partial<NewBuildRow> = {
    status: "failed",
    error: opts.error,
    finishedAt: new Date(),
  }
  if (opts.needsIosCredentials !== undefined) values.needsIosCredentials = opts.needsIosCredentials
  if (opts.easBuildId) values.easBuildId = opts.easBuildId
  if (opts.workflowRunUrl) values.workflowRunUrl = opts.workflowRunUrl

  await db.update(builds).set(values).where(eq(builds.id, buildId))
}

/** Fails the build only while it is still in flight, so a late "ready" is never overwritten. */
export async function cancelActiveBuild(buildId: string, error: string): Promise<boolean> {
  const stopped = await db
    .update(builds)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(and(eq(builds.id, buildId), inArray(builds.status, ["queued", "dispatching", "building"])))
    .returning({ id: builds.id })
  return stopped.length > 0
}
