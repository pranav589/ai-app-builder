import { createHmac, timingSafeEqual } from "node:crypto"
import { JobsError, workerBaseUrl, type IncomingHeaders, type JobQueue, type JobRun, type JobRunStatus } from "./queue"

// Cloudhike Jobs (https://cloudhike.dev/docs/jobs): an HTTP queue. We POST a
// run, a Cloudhike worker calls our URL and waits for the answer (5 min on
// Free, 60 on Pro). Jobs only returns the finished answer, with no streaming,
// so live output goes through agent_events (see lib/agent/run-store.ts).

const apiUrl = () => process.env.JOBS_API_URL?.replace(/\/+$/, "")
const apiKey = () => process.env.JOBS_API_KEY

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

/**
 * Checks `x-cloudhike-signature: t=<unix seconds>,v1=<hex>`, where v1 is
 * HMAC-SHA256 of `<t>.<raw body>` keyed with JOBS_API_KEY.
 */
function verifySignature(rawBody: string, headers: IncomingHeaders, toleranceSeconds = 300) {
  const key = apiKey()
  const header = headers["x-cloudhike-signature"]
  if (!key || typeof header !== "string") return false
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

export const cloudhikeJobs: JobQueue = {
  isConfigured: () => Boolean(apiUrl() && apiKey()),
  enqueue: (input) =>
    call<{ id: string; status: JobRunStatus; statusUrl?: string }>("/runs", {
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
    }),
  get: (id) => call<JobRun>(`/runs/${encodeURIComponent(id)}`),
  verifySignature,
  // Free allows up to 300 s per run, Pro up to 3600 s.
  maxTimeoutSeconds: 3600,
}
