import { and, desc, eq, inArray } from "drizzle-orm"
import {
  db,
  webDeployRuns,
  webDeployments,
  type NewWebDeploymentRow,
  type WebDeployRunRow,
  type WebDeploymentRow,
} from "@/db"

export async function claimWebDeployment(opts: {
  projectId: string
  userId: string
  repoOwner: string
  repoName: string
}): Promise<
  { ok: true; deployment: WebDeploymentRow; runId: string } | { ok: false; error: "deploy_in_progress" }
> {
  const { projectId, userId, repoOwner, repoName } = opts
  const runId = crypto.randomUUID()

  const [claimed] = await db
    .update(webDeployments)
    .set({
      status: "queued",
      error: null,
      userId,
      repoOwner,
      repoName,
      currentRunId: runId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(webDeployments.projectId, projectId),
        inArray(webDeployments.status, ["ready", "failed"])
      )
    )
    .returning()

  let deployment: WebDeploymentRow | null = claimed || null

  if (!deployment) {
    const [existing] = await db
      .select()
      .from(webDeployments)
      .where(eq(webDeployments.projectId, projectId))
      .limit(1)

    if (existing) {
      return { ok: false, error: "deploy_in_progress" }
    }

    const [inserted] = await db
      .insert(webDeployments)
      .values({
        projectId,
        userId,
        status: "queued",
        repoOwner,
        repoName,
        currentRunId: runId,
      })
      .returning()
    deployment = inserted
  }

  await db.insert(webDeployRuns).values({
    id: runId,
    projectId,
    userId,
    status: "queued",
    repoOwner,
    repoName,
  })

  return { ok: true, deployment, runId }
}

export async function getWebDeployment(projectId: string): Promise<WebDeploymentRow | null> {
  const [row] = await db
    .select()
    .from(webDeployments)
    .where(eq(webDeployments.projectId, projectId))
    .limit(1)
  return row || null
}

export async function listWebDeployRuns(projectId: string, limit = 20): Promise<WebDeployRunRow[]> {
  return db
    .select()
    .from(webDeployRuns)
    .where(eq(webDeployRuns.projectId, projectId))
    .orderBy(desc(webDeployRuns.createdAt))
    .limit(limit)
}

/** Only applies the pointer update if `runId` is still the run the pointer is tracking — guards against a late webhook from a superseded run. */
async function updatePointerForRun(
  projectId: string,
  runId: string,
  values: Partial<NewWebDeploymentRow>
): Promise<void> {
  await db
    .update(webDeployments)
    .set(values)
    .where(and(eq(webDeployments.projectId, projectId), eq(webDeployments.currentRunId, runId)))
}

export async function markWebDispatched(
  projectId: string,
  runId: string,
  opts: {
    workflowRunId?: string | null
    workflowRunUrl?: string | null
  } = {}
): Promise<void> {
  // Called twice: once right after dispatch (opts empty, flips queued -> dispatching), and again
  // later once correlateWorkflowRun finds the run (opts carries the run id/url, status untouched).
  const [runRow] = await db.select().from(webDeployRuns).where(eq(webDeployRuns.id, runId)).limit(1)
  if (!runRow) return

  const runValues: Partial<typeof webDeployRuns.$inferInsert> = {}
  if (runRow.status === "queued") {
    runValues.status = "dispatching"
    runValues.dispatchedAt = new Date()
  }
  if (opts.workflowRunId !== undefined) runValues.workflowRunId = opts.workflowRunId
  if (opts.workflowRunUrl !== undefined) runValues.workflowRunUrl = opts.workflowRunUrl
  if (Object.keys(runValues).length) {
    await db.update(webDeployRuns).set(runValues).where(eq(webDeployRuns.id, runId))
  }

  const pointerValues: Partial<NewWebDeploymentRow> = { updatedAt: new Date() }
  if (runRow.status === "queued") {
    pointerValues.status = "dispatching"
    pointerValues.dispatchedAt = new Date()
  }
  if (opts.workflowRunId !== undefined) pointerValues.workflowRunId = opts.workflowRunId
  if (opts.workflowRunUrl !== undefined) pointerValues.workflowRunUrl = opts.workflowRunUrl
  await updatePointerForRun(projectId, runId, pointerValues)
}

export async function markWebBuilding(projectId: string, runId: string): Promise<void> {
  await db
    .update(webDeployRuns)
    .set({ status: "building" })
    .where(and(eq(webDeployRuns.id, runId), inArray(webDeployRuns.status, ["dispatching", "building"])))

  await updatePointerForRun(projectId, runId, { status: "building", updatedAt: new Date() })
}

export async function markWebDeploying(projectId: string, runId: string): Promise<void> {
  await db
    .update(webDeployRuns)
    .set({ status: "deploying" })
    .where(
      and(eq(webDeployRuns.id, runId), inArray(webDeployRuns.status, ["dispatching", "building", "deploying"]))
    )

  await updatePointerForRun(projectId, runId, { status: "deploying", updatedAt: new Date() })
}

export async function markWebReady(
  projectId: string,
  runId: string,
  opts: {
    url: string
    workflowRunUrl?: string | null
  }
): Promise<void> {
  const runValues: Partial<typeof webDeployRuns.$inferInsert> = {
    status: "ready",
    url: opts.url,
    error: null,
    finishedAt: new Date(),
  }
  if (opts.workflowRunUrl) runValues.workflowRunUrl = opts.workflowRunUrl
  await db.update(webDeployRuns).set(runValues).where(eq(webDeployRuns.id, runId))

  const pointerValues: Partial<NewWebDeploymentRow> = {
    status: "ready",
    url: opts.url,
    error: null,
    lastDeployedAt: new Date(),
    updatedAt: new Date(),
  }
  if (opts.workflowRunUrl) pointerValues.workflowRunUrl = opts.workflowRunUrl
  await updatePointerForRun(projectId, runId, pointerValues)
}

export async function markWebFailed(
  projectId: string,
  runId: string,
  error: string,
  opts: {
    workflowRunUrl?: string | null
  } = {}
): Promise<void> {
  const runValues: Partial<typeof webDeployRuns.$inferInsert> = {
    status: "failed",
    error,
    finishedAt: new Date(),
  }
  if (opts.workflowRunUrl) runValues.workflowRunUrl = opts.workflowRunUrl
  await db.update(webDeployRuns).set(runValues).where(eq(webDeployRuns.id, runId))

  // The pointer's `url` is intentionally left untouched on failure, so the last-known-good
  // live URL keeps showing even if a republish attempt fails.
  const pointerValues: Partial<NewWebDeploymentRow> = {
    status: "failed",
    error,
    updatedAt: new Date(),
  }
  if (opts.workflowRunUrl) pointerValues.workflowRunUrl = opts.workflowRunUrl
  await updatePointerForRun(projectId, runId, pointerValues)
}
