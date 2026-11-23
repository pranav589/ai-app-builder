import { and, desc, eq, inArray } from "drizzle-orm"
import {
  db,
  webDeployRuns,
  webDeployments,
  type NewWebDeploymentRow,
  type WebDeployRunRow,
  type WebDeploymentRow,
} from "@/db"

/**
 * A deploy's run row and its pointer row always change together. Writing them in one
 * transaction makes Postgres deliver their change notifications together at commit, so
 * clients refetch once instead of once per row, however slow the database round trip is.
 */
type Db = Pick<typeof db, "insert" | "select" | "update">

export async function claimWebDeployment(opts: {
  projectId: string
  userId: string
  repoOwner: string
  repoName: string
}): Promise<
  { ok: true; deployment: WebDeploymentRow; runId: string } | { ok: false; error: "deploy_in_progress" }
> {
  const runId = crypto.randomUUID()
  return db.transaction((tx) => claim(tx, opts, runId))
}

async function claim(
  tx: Db,
  { projectId, userId, repoOwner, repoName }: Parameters<typeof claimWebDeployment>[0],
  runId: string
): Promise<
  { ok: true; deployment: WebDeploymentRow; runId: string } | { ok: false; error: "deploy_in_progress" }
> {
  const [claimed] = await tx
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
    const [existing] = await tx
      .select()
      .from(webDeployments)
      .where(eq(webDeployments.projectId, projectId))
      .limit(1)

    if (existing) {
      return { ok: false, error: "deploy_in_progress" }
    }

    const [inserted] = await tx
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

  await tx.insert(webDeployRuns).values({
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
  tx: Db,
  projectId: string,
  runId: string,
  values: Partial<NewWebDeploymentRow>
): Promise<void> {
  await tx
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

  const pointerValues: Partial<NewWebDeploymentRow> = { updatedAt: new Date() }
  if (runRow.status === "queued") {
    pointerValues.status = "dispatching"
    pointerValues.dispatchedAt = new Date()
  }
  if (opts.workflowRunId !== undefined) pointerValues.workflowRunId = opts.workflowRunId
  if (opts.workflowRunUrl !== undefined) pointerValues.workflowRunUrl = opts.workflowRunUrl
  await db.transaction(async (tx) => {
    if (Object.keys(runValues).length) {
      await tx.update(webDeployRuns).set(runValues).where(eq(webDeployRuns.id, runId))
    }
    await updatePointerForRun(tx, projectId, runId, pointerValues)
  })
}

export async function markWebBuilding(projectId: string, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(webDeployRuns)
      .set({ status: "building" })
      .where(and(eq(webDeployRuns.id, runId), inArray(webDeployRuns.status, ["dispatching", "building"])))
    await updatePointerForRun(tx, projectId, runId, { status: "building", updatedAt: new Date() })
  })
}

export async function markWebDeploying(projectId: string, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(webDeployRuns)
      .set({ status: "deploying" })
      .where(
        and(eq(webDeployRuns.id, runId), inArray(webDeployRuns.status, ["dispatching", "building", "deploying"]))
      )
    await updatePointerForRun(tx, projectId, runId, { status: "deploying", updatedAt: new Date() })
  })
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

  const pointerValues: Partial<NewWebDeploymentRow> = {
    status: "ready",
    url: opts.url,
    error: null,
    lastDeployedAt: new Date(),
    updatedAt: new Date(),
  }
  if (opts.workflowRunUrl) pointerValues.workflowRunUrl = opts.workflowRunUrl
  await db.transaction(async (tx) => {
    await tx.update(webDeployRuns).set(runValues).where(eq(webDeployRuns.id, runId))
    await updatePointerForRun(tx, projectId, runId, pointerValues)
  })
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

  // The pointer's `url` is intentionally left untouched on failure, so the last-known-good
  // live URL keeps showing even if a republish attempt fails.
  const pointerValues: Partial<NewWebDeploymentRow> = {
    status: "failed",
    error,
    updatedAt: new Date(),
  }
  if (opts.workflowRunUrl) pointerValues.workflowRunUrl = opts.workflowRunUrl
  await db.transaction(async (tx) => {
    await tx.update(webDeployRuns).set(runValues).where(eq(webDeployRuns.id, runId))
    await updatePointerForRun(tx, projectId, runId, pointerValues)
  })
}

/** Fails the deployment's current run only while it is still in flight. Returns false when there is nothing to stop. */
export async function cancelWebDeployment(projectId: string, error: string): Promise<boolean> {
  const [run] = await db
    .select({ id: webDeployRuns.id })
    .from(webDeployRuns)
    .innerJoin(webDeployments, eq(webDeployments.currentRunId, webDeployRuns.id))
    .where(
      and(
        eq(webDeployments.projectId, projectId),
        inArray(webDeployments.status, ["queued", "dispatching", "building", "deploying"])
      )
    )
    .limit(1)
  if (!run) return false
  await markWebFailed(projectId, run.id, error)
  return true
}
