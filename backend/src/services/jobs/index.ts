import { cloudhikeJobs } from "./cloudhike-jobs"
import { isPublicUrl, JobsError, workerBaseUrl, type JobQueue } from "./queue"

export * from "./queue"

/** The queue agent runs go through. Moving to another one means implementing JobQueue and changing this line. */
export const jobQueue: JobQueue = cloudhikeJobs

let warned = false

/**
 * Where agent runs execute. AGENT_RUNNER=inline forces in-process, any other
 * value forces the queue; unset, the queue is used when it is configured and
 * the app has a public URL, and runs stay in-process (local dev) otherwise.
 */
export function agentRunner(): "queue" | "inline" {
  const forced = process.env.AGENT_RUNNER
  if (forced === "inline") return "inline"
  const configured = jobQueue.isConfigured() && isPublicUrl(workerBaseUrl())
  if (forced && !configured) throw new JobsError(`AGENT_RUNNER=${forced} needs the job queue configured and a public JOBS_WORKER_URL.`, 500)
  if (!configured && !warned) {
    warned = true
    console.warn("Job queue not used for agent runs (needs its credentials and a public JOBS_WORKER_URL); running in-process.")
  }
  return configured ? "queue" : "inline"
}

/** JOBS_TIMEOUT_SECONDS, capped at what the queue allows (default 300 s). */
export function jobTimeoutSeconds() {
  const n = Number(process.env.JOBS_TIMEOUT_SECONDS)
  return Number.isFinite(n) && n >= 10 ? Math.min(Math.floor(n), jobQueue.maxTimeoutSeconds) : 300
}
