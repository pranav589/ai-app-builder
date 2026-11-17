import "server-only"
import { randomBytes } from "node:crypto"
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm"

import { agentEvents, agentRuns, db, type AgentRunRow, type AgentRunStatus } from "@/db"
import { getJob } from "@/lib/jobs/cloudhike-jobs"
import { foldSnapshot, type LiveRun } from "./registry"
import type { AgentEvent } from "./types"

// Agent runs live in Postgres so they can execute in a Cloudhike Jobs worker
// (or any server instance) while the browser streams them from here:
//
//   browser ── POST /agent ──> open run row ── enqueue ──> Cloudhike Jobs
//      ^                                                      │ calls
//      └── SSE: follow agent_events by seq <── append ── /api/jobs/agent (worker)
//
// The worker holds the run with a heartbeat; a run whose heartbeat stops is
// treated as dead, so a crashed worker never locks a project for good.

export const HEARTBEAT_MS = 15_000
/** A running run without a heartbeat for this long is dead. */
const STALE_RUNNING_S = 90
/** A run Cloudhike never started (busy workers, bad URL) gives up after this long. */
const STALE_QUEUED_S = 15 * 60
/** Finished runs (and their events) are kept this long. */
const KEEP_FINISHED_S = 2 * 24 * 3600

const ACTIVE: AgentRunStatus[] = ["queued", "running"]
const FINISHED: AgentRunStatus[] = ["succeeded", "failed", "cancelled"]

export type RunInput = {
  task: "plan" | "generate" | "backend"
  action: "start" | "resume" | "message" | "approve" | "backend"
  /** For "backend": the CloudHike services to deploy, and whose account to use. */
  services?: string[]
  userId?: string
}

const newId = () => `run-${Date.now()}-${randomBytes(4).toString("hex")}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code === "23505" || err?.cause?.code === "23505"
}

const staleCondition = sql`(
  (${agentRuns.status} = 'running' and coalesce(${agentRuns.heartbeatAt}, ${agentRuns.createdAt}) < now() - make_interval(secs => ${STALE_RUNNING_S}))
  or (${agentRuns.status} = 'queued' and ${agentRuns.createdAt} < now() - make_interval(secs => ${STALE_QUEUED_S}))
)`

// ---------------------------------------------------------------- lock

export async function activeRun(projectId: string): Promise<AgentRunRow | null> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, projectId), inArray(agentRuns.status, ACTIVE)))
    .limit(1)
  return row ?? null
}

/**
 * Takes the project's single run slot. Returns null when another run is
 * active. Dead runs are cleared first, and old finished runs pruned.
 */
export async function openRun(projectId: string, kind: "agent" | "repair", input?: RunInput): Promise<AgentRunRow | null> {
  await expireStaleRuns(projectId)
  db.delete(agentRuns)
    .where(
      and(
        eq(agentRuns.projectId, projectId),
        inArray(agentRuns.status, FINISHED),
        lt(agentRuns.createdAt, sql`now() - make_interval(secs => ${KEEP_FINISHED_S})`)
      )
    )
    .catch((e) => console.error("pruning agent runs failed", e))
  try {
    const [row] = await db
      .insert(agentRuns)
      .values({
        id: newId(),
        projectId,
        kind,
        input: input ?? null,
        // A repair runs right here, so it starts out running.
        status: kind === "repair" ? "running" : "queued",
        heartbeatAt: kind === "repair" ? new Date() : null,
        startedAt: kind === "repair" ? new Date() : null,
      })
      .returning()
    return row
  } catch (e) {
    if (isUniqueViolation(e)) return null
    throw e
  }
}

export async function setJobId(runId: string, jobId: string) {
  await db.update(agentRuns).set({ jobId }).where(eq(agentRuns.id, runId))
}

/**
 * Worker side: takes the run if it is queued, or running with a dead worker
 * (a retry after a crash). Returns null for duplicate deliveries.
 */
export async function claimRun(runId: string): Promise<AgentRunRow | null> {
  const [row] = await db
    .update(agentRuns)
    .set({
      status: "running",
      startedAt: sql`coalesce(${agentRuns.startedAt}, now())`,
      heartbeatAt: sql`now()`,
      attempts: sql`${agentRuns.attempts} + 1`,
    })
    .where(
      and(
        eq(agentRuns.id, runId),
        or(
          eq(agentRuns.status, "queued"),
          and(eq(agentRuns.status, "running"), lt(agentRuns.heartbeatAt, sql`now() - make_interval(secs => ${STALE_RUNNING_S})`))
        )
      )
    )
    .returning()
  return row ?? null
}

/** Keeps the run alive while it works. */
export function holdRun(runId: string) {
  const beat = () =>
    db
      .update(agentRuns)
      .set({ heartbeatAt: sql`now()` })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")))
      .catch((e) => console.error("agent run heartbeat failed", runId, e))
  const timer = setInterval(beat, HEARTBEAT_MS)
  return () => clearInterval(timer)
}

export async function finishRun(runId: string, status: Exclude<AgentRunStatus, "queued" | "running">, error?: string) {
  await db
    .update(agentRuns)
    .set({ status, error: error?.slice(0, 2000) ?? null, finishedAt: sql`now()` })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ACTIVE)))
}

/**
 * Fails a run on behalf of a dead worker: the conditional update makes sure
 * only one caller wins, and only the winner writes the closing events.
 */
async function failRun(runId: string, reason: string, message: string, only: "stale" | "queued") {
  const [row] = await db
    .update(agentRuns)
    .set({ status: "failed", error: reason.slice(0, 2000), finishedAt: sql`now()` })
    .where(
      and(
        eq(agentRuns.id, runId),
        only === "stale" ? and(inArray(agentRuns.status, ACTIVE), staleCondition) : eq(agentRuns.status, "queued")
      )
    )
    .returning({ id: agentRuns.id })
  if (!row) return false
  const seq = await lastSeq(runId)
  await db.insert(agentEvents).values([
    { runId, seq: seq + 1, event: { type: "error", message, retryable: true } satisfies AgentEvent },
    { runId, seq: seq + 2, event: { type: "done" } satisfies AgentEvent },
  ])
  return true
}

const DEAD_MESSAGE = "The agent stopped responding. Retry to pick up where it left off."

async function expireStaleRuns(projectId: string) {
  const stale = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, projectId), inArray(agentRuns.status, ACTIVE), staleCondition))
  for (const r of stale) await failRun(r.id, "stale: no heartbeat", DEAD_MESSAGE, "stale")
}

export async function failQueuedRun(runId: string, reason: string, message: string) {
  return failRun(runId, reason, message, "queued")
}

// ---------------------------------------------------------------- events

async function lastSeq(runId: string) {
  const [row] = await db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.runId, runId))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
  return row?.seq ?? 0
}

const FLUSH_MS = 120

/**
 * The LiveRun the orchestrator emits into. Events are batched every
 * FLUSH_MS: consecutive text/code deltas are merged into one row and a status
 * line only keeps its latest value, so the stream carries what changed rather
 * than a row per token.
 */
export async function createEventSink(runId: string, projectId: string) {
  let seq = await lastSeq(runId)
  let buf: AgentEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()
  let lastStatus: string | null = null

  const push = (e: AgentEvent) => {
    const last = buf[buf.length - 1]
    if (e.type === "text" && last?.type === "text" && last.id === e.id) {
      buf[buf.length - 1] = { ...last, delta: last.delta + e.delta }
    } else if (e.type === "screen_delta" && last?.type === "screen_delta" && last.id === e.id) {
      buf[buf.length - 1] = { ...last, delta: last.delta + e.delta }
    } else if (e.type === "status" && last?.type === "status") {
      buf[buf.length - 1] = e
    } else {
      buf.push(e)
    }
  }

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!buf.length) return chain
    const rows = buf.map((event) => ({ runId, seq: ++seq, event }))
    buf = []
    chain = chain.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await db.insert(agentEvents).values(rows)
          return
        } catch (e) {
          if (attempt >= 2) {
            console.error("saving agent events failed", runId, e)
            return
          }
          await sleep(300 * (attempt + 1))
        }
      }
    })
    return chain
  }

  const run: LiveRun & { close: () => Promise<void> } = {
    projectId,
    emit(e) {
      // The same status line twice in a row says nothing new.
      if (e.type === "status") {
        if (e.text === lastStatus) return
        lastStatus = e.text
      }
      push(e)
      if (e.type === "done" || e.type === "error") void flush()
      else timer ??= setTimeout(() => void flush(), FLUSH_MS)
    },
    close: () => flush(),
  }
  return run
}

/** A LiveRun that drops its events (repairs report through their HTTP answer). */
export const silentRun = (projectId: string): LiveRun => ({ projectId, emit() {} })

// ---------------------------------------------------------------- streaming to the browser

const encoder = new TextEncoder()
const sse = (e: AgentEvent) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`)

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
}

export function eventStreamResponse(events: AgentEvent[]) {
  return new Response(new Uint8Array(events.flatMap((e) => [...sse(e)])), { headers: SSE_HEADERS })
}

/**
 * A text/event-stream that follows a run's events until its "done" event or
 * the browser leaves. A new run is streamed from the start; joining a run
 * already under way sends one snapshot, then everything after it.
 */
export function streamRun(runId: string, opts: { join: boolean; signal?: AbortSignal }) {
  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        stop()
        try {
          controller.close()
        } catch {}
      }
      const send = (e: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(sse(e))
        } catch {
          close()
        }
      }
      // Keeps proxies from closing a stream that is waiting on a slow model.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          close()
        }
      }, 15_000)
      const onAbort = () => close()
      opts.signal?.addEventListener("abort", onAbort)
      stop = () => {
        clearInterval(ping)
        opts.signal?.removeEventListener("abort", onAbort)
      }

      void follow(runId, opts.join, send, () => closed).finally(close)
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}

async function follow(runId: string, join: boolean, send: (e: AgentEvent) => void, isClosed: () => boolean) {
  let cursor = 0
  if (join) {
    const rows = await db
      .select({ seq: agentEvents.seq, event: agentEvents.event })
      .from(agentEvents)
      .where(eq(agentEvents.runId, runId))
      .orderBy(asc(agentEvents.seq))
    const events = rows.map((r) => r.event as AgentEvent)
    if (events.some((e) => e.type === "done")) {
      // Finished between the lock check and now: replay the ending.
      for (const e of events.filter((e) => e.type === "phase" || e.type === "error" || e.type === "done").slice(-3)) send(e)
      return
    }
    const snap = foldSnapshot(events)
    send({ type: "snapshot", status: snap.status, message: snap.message, screen: snap.screen })
    cursor = rows.at(-1)?.seq ?? 0
  }

  let idleSince = Date.now()
  let lastCheck = 0
  let lastJobCheck = 0
  let toldQueued = false
  let failures = 0

  while (!isClosed()) {
    let rows: { seq: number; event: unknown }[]
    try {
      rows = await db
        .select({ seq: agentEvents.seq, event: agentEvents.event })
        .from(agentEvents)
        .where(and(eq(agentEvents.runId, runId), gt(agentEvents.seq, cursor)))
        .orderBy(asc(agentEvents.seq))
        .limit(500)
      failures = 0
    } catch (e) {
      if (++failures >= 5) {
        console.error("following agent run failed", runId, e)
        send({ type: "error", message: "Lost the connection to the agent. It may still be working.", retryable: true })
        return
      }
      await sleep(1000)
      continue
    }

    for (const r of rows) {
      cursor = r.seq
      const e = r.event as AgentEvent
      send(e)
      if (e.type === "done") return
    }
    if (rows.length) {
      idleSince = Date.now()
      continue
    }

    // Nothing new: check on the run itself now and then.
    const now = Date.now()
    if (now - lastCheck > 3000) {
      lastCheck = now
      const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1)
      if (!run) {
        send({ type: "done" })
        return
      }
      if (FINISHED.includes(run.status)) {
        // The worker finished; its last events may land a moment after the row.
        if (now - (run.finishedAt?.getTime() ?? 0) > 5000) {
          send({ type: "done" })
          return
        }
      } else if (await expireIfStale(run)) {
        continue
      } else if (run.status === "queued") {
        if (!toldQueued && now - run.createdAt.getTime() > 4000) {
          toldQueued = true
          send({ type: "status", text: "Waiting for a free worker" })
        }
        // A run Cloudhike gave up on (unreachable URL, refused signature) never reports in.
        if (run.jobId && now - lastJobCheck > 6000) {
          lastJobCheck = now
          await checkJob(run).catch((e) => console.error("checking Cloudhike job failed", run.jobId, e))
        }
      }
    }
    // Poll quickly while the run is talking, slower while it is quiet.
    await sleep(now - idleSince < 5000 ? 150 : 500)
  }
}

async function expireIfStale(run: AgentRunRow) {
  const age = (d: Date | null) => (Date.now() - (d ?? run.createdAt).getTime()) / 1000
  const stale = run.status === "running" ? age(run.heartbeatAt) > STALE_RUNNING_S : age(run.createdAt) > STALE_QUEUED_S
  return stale && failRun(run.id, "stale: no heartbeat", DEAD_MESSAGE, "stale")
}

async function checkJob(run: AgentRunRow) {
  const job = await getJob(run.jobId!)
  if (job.status === "failed" || job.status === "cancelled" || job.status === "succeeded") {
    // Succeeded while our row is still queued means the worker skipped it.
    await failQueuedRun(run.id, `cloudhike job ${job.status}: ${job.error ?? ""}`, "The agent couldn't start. Please try again.")
  }
}
