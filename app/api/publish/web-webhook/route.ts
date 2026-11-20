import { eq } from "drizzle-orm"
import { db, webDeployRuns } from "@/db"
import { json } from "@/lib/http"
import { updateEasProject } from "@/lib/publish/app-identity"
import { verifyPublishWebhookSignature } from "@/lib/publish/webhook-auth"
import { markWebBuilding, markWebDeploying, markWebFailed, markWebReady } from "@/lib/publish/web-deploy"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const rawBody = await req.text()
  const sigHeader = req.headers.get("x-publish-signature")

  if (!verifyPublishWebhookSignature(rawBody, sigHeader)) {
    return json({ error: "Invalid webhook signature" }, 401)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  const projectId = typeof payload.projectId === "string" ? payload.projectId : ""
  const runId = typeof payload.runId === "string" ? payload.runId : ""
  if (!projectId || !runId) {
    return json({ error: "Missing projectId or runId" }, 400)
  }

  const [run] = await db.select().from(webDeployRuns).where(eq(webDeployRuns.id, runId)).limit(1)
  if (!run) {
    return json({ error: "Deploy run not found" }, 404)
  }

  // Update EAS project identifier or owner if assigned
  const easProjectId = typeof payload.easProjectId === "string" ? payload.easProjectId : null
  const expoOwner = typeof payload.expoOwner === "string" ? payload.expoOwner : null
  if (easProjectId || expoOwner) {
    await updateEasProject(projectId, { easProjectId, expoOwner }).catch(() => {})
  }

  // Mid-workflow pings
  const stage = typeof payload.stage === "string" ? payload.stage.toLowerCase() : ""
  if (stage === "building") {
    await markWebBuilding(projectId, runId)
    return json({ ok: true, stage: "building" }, 200)
  }
  if (stage === "deploying") {
    await markWebDeploying(projectId, runId)
    return json({ ok: true, stage: "deploying" }, 200)
  }

  // Idempotency: if this run is already in a terminal state, don't re-process.
  if (run.status === "ready" || run.status === "failed") {
    return json({ ok: true, alreadyFinished: true }, 200)
  }

  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : ""
  const url = typeof payload.url === "string" ? payload.url : null
  const error = typeof payload.error === "string" ? payload.error : null
  const workflowRunUrl = typeof payload.workflowRunUrl === "string" ? payload.workflowRunUrl : null

  if (status === "ready" && url) {
    await markWebReady(projectId, runId, { url, workflowRunUrl })
  } else {
    await markWebFailed(
      projectId,
      runId,
      error || (status === "ready" && !url ? "Deployment completed but no live URL was returned" : "Web deployment failed"),
      { workflowRunUrl }
    )
  }

  return json({ ok: true }, 200)
}
