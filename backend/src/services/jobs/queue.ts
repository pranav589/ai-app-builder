// The queue agent runs go through in production: we enqueue a POST to our own
// worker route, the queue calls it (signed) and we follow progress through
// agent_events, so a queue only needs enqueue, a status read and a signature
// check. Implementations live next to this file; index.ts picks one.

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export type JobRun = { id: string; status: JobRunStatus; error?: string | null }

export class JobsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export type IncomingHeaders = Record<string, string | string[] | undefined>

export interface JobQueue {
  /** True when credentials are set; the caller separately checks the worker URL is reachable. */
  isConfigured(): boolean
  /** Queues a POST of `body` to `${workerBaseUrl()}${path}`. */
  enqueue(input: { path: string; body: unknown; timeoutSeconds: number; retries: number }): Promise<{ id: string }>
  get(id: string): Promise<JobRun>
  /** Whether a worker request really came from this queue. */
  verifySignature(rawBody: string, headers: IncomingHeaders): boolean
  /** Longest run this queue allows, in seconds. */
  maxTimeoutSeconds: number
}

/** Public base URL the queue calls back into. */
export function workerBaseUrl() {
  return (process.env.JOBS_WORKER_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
}

/** A hosted queue can't call localhost or a private network. */
export function isPublicUrl(raw: string) {
  try {
    const { hostname, protocol } = new URL(raw)
    if (protocol !== "https:" && protocol !== "http:") return false
    const h = hostname.toLowerCase()
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1" || h === "[::1]") return false
    if (/^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
    return true
  } catch {
    return false
  }
}
