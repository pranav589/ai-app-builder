import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

// Cloudhike Jobs (https://cloudhike.dev/docs/jobs): an HTTP queue. We POST a
// run, a Cloudhike worker calls our URL and waits for the answer (5 min on
// Free, 60 on Pro). Jobs only returns the finished answer, with no streaming,
// so live output goes through agent_events (see lib/agent/run-store.ts).

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export type JobRun = {
  id: string
  status: JobRunStatus
  attempts?: number
  maxAttempts?: number
  error?: string | null
  response?: { status: number; body: unknown; truncated?: boolean } | null
}

export class JobsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const apiUrl = () => process.env.JOBS_API_URL?.replace(/\/+$/, "")
const apiKey = () => process.env.JOBS_API_KEY

/** Public base URL Cloudhike calls back into (it refuses localhost and private networks). */
export function workerBaseUrl() {
  return (process.env.JOBS_WORKER_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
}

function isPublicUrl(raw: string) {
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

let warned = false

/**
 * Where agent runs execute. AGENT_RUNNER=cloudhike|inline forces a mode;
 * otherwise Cloudhike Jobs is used when it is configured and the app has a
 * public URL, and runs stay in-process (local dev) when it does not.
 */
export function agentRunner(): "cloudhike" | "inline" {
  const forced = process.env.AGENT_RUNNER
  if (forced === "inline") return "inline"
  const configured = Boolean(apiUrl() && apiKey() && isPublicUrl(workerBaseUrl()))
  if (forced === "cloudhike" && !configured)
    throw new JobsError("AGENT_RUNNER=cloudhike needs JOBS_API_URL, JOBS_API_KEY and a public JOBS_WORKER_URL.", 500)
  if (!configured && !warned) {
    warned = true
    console.warn("Cloudhike Jobs not used for agent runs (needs JOBS_API_URL, JOBS_API_KEY and a public JOBS_WORKER_URL); running in-process.")
  }
  return configured ? "cloudhike" : "inline"
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = apiUrl()
  const key = apiKey()
  if (!base || !key) throw new JobsError("Cloudhike Jobs is not configured.", 500)
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": key, ...init.headers },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new JobsError(`Cloudhike Jobs ${init.method ?? "GET"} ${path} answered ${res.status}: ${text.slice(0, 300)}`, res.status)
  }
  return (await res.json()) as T
}

/** Queues a POST to our own worker route. Answers 202 with the run id. */
export function enqueueJob(input: { path: string; body: unknown; timeoutSeconds: number; retries: number }) {
  return call<{ id: string; status: JobRunStatus; statusUrl?: string }>("/runs", {
    method: "POST",
    body: JSON.stringify({
      url: `${workerBaseUrl()}${input.path}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.body),
      timeoutSeconds: input.timeoutSeconds,
      retries: input.retries,
      // We follow progress through agent_events, so no webhook is needed.
      callbackUrl: null,
    }),
  })
}

export function getJob(id: string) {
  return call<JobRun>(`/runs/${encodeURIComponent(id)}`)
}

export function cancelJob(id: string) {
  return call<JobRun>(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" })
}

/** Free allows up to 300 s per run, Pro up to 3600 s. */
export function jobTimeoutSeconds() {
  const n = Number(process.env.JOBS_TIMEOUT_SECONDS)
  return Number.isFinite(n) && n >= 10 ? Math.min(Math.floor(n), 3600) : 300
}

/**
 * Checks `x-cloudhike-signature: t=<unix seconds>,v1=<hex>`, where v1 is
 * HMAC-SHA256 of `<t>.<raw body>` keyed with JOBS_API_KEY.
 */
export function verifyJobSignature(rawBody: string, header: string | null, toleranceSeconds = 300) {
  const key = apiKey()
  if (!key || !header) return false
  let t = ""
  const sigs: string[] = []
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2)
    if (k === "t") t = v ?? ""
    else if (k === "v1" && v) sigs.push(v)
  }
  const ts = Number(t)
  if (!t || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false
  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest()
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex")
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}
