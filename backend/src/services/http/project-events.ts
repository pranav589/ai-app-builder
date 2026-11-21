import postgres from "postgres"

// Fans Postgres NOTIFY messages (db/sql/status-notify.sql) out to in-process subscribers,
// keyed by project, so one LISTEN connection serves every open SSE stream.

export type ProjectStatusTable = "device_builds" | "builds" | "web_deployments" | "web_deploy_runs"
/** `resync` means the listener reconnected and may have missed events: refetch everything. */
export type ProjectStatusEvent = { table: ProjectStatusTable } | { resync: true }

type Listener = (e: ProjectStatusEvent) => void

const CHANNEL = "project_status"
const subscribers = new Map<string, Set<Listener>>()
let started: Promise<unknown> | null = null

function dispatch(projectId: string, e: ProjectStatusEvent) {
  for (const l of subscribers.get(projectId) ?? []) l(e)
}

export function handleNotification(payload: string) {
  try {
    const { table, projectId } = JSON.parse(payload) as { table: ProjectStatusTable; projectId: string }
    dispatch(projectId, { table })
  } catch {
    // A malformed payload can only come from someone hand-NOTIFYing the channel.
  }
}

function start() {
  // LISTEN needs a session-pinned connection: DATABASE_URL may go through a transaction-mode
  // pooler (PgBouncer), which silently drops it, so prefer the direct URL.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL")
  const listener = postgres(url, { max: 1, prepare: false, onnotice: () => {} })
  // `onlisten` fires on the first connect and after every automatic reconnect; anything
  // notified while the connection was down is gone, so tell clients to resync.
  started = listener.listen(
    CHANNEL,
    handleNotification,
    () => {
      for (const id of subscribers.keys()) dispatch(id, { resync: true })
    }
  )
  started.catch((e) => {
    console.error("listening for project status changes failed", e)
    started = null
  })
}

export function subscribeToProject(projectId: string, listener: Listener): () => void {
  if (!started) start()
  let set = subscribers.get(projectId)
  if (!set) subscribers.set(projectId, (set = new Set()))
  set.add(listener)
  return () => {
    set.delete(listener)
    if (!set.size) subscribers.delete(projectId)
  }
}
