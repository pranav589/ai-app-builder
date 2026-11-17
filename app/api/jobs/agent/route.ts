import { executeRun } from "@/lib/agent/execute"
import { json } from "@/lib/http"
import { verifyJobSignature } from "@/lib/jobs/cloudhike-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Cloudhike waits up to JOBS_TIMEOUT_SECONDS (300 s Free, 3600 s Pro) for the answer.
export const maxDuration = 3600

/**
 * Cloudhike Jobs worker: runs one agent run (planning, building, editing).
 * Progress streams to the workspace through agent_events, not through this
 * answer; the answer only tells Cloudhike how it went.
 */
export async function POST(req: Request) {
  const raw = await req.text()
  if (!verifyJobSignature(raw, req.headers.get("x-cloudhike-signature"))) return json({ error: "Bad signature" }, 401)

  let runId = ""
  try {
    runId = String((JSON.parse(raw) as { runId?: unknown }).runId ?? "")
  } catch {}
  if (!runId) return json({ error: "Bad request" }, 400)

  // Delivery is at least once; executeRun's claim makes a repeat a no-op.
  const result = await executeRun(runId)
  // 200 even when the agent failed: the failure is already shown to the user,
  // and a retry from Cloudhike would only repeat it.
  return json({ runId, ...result })
}
