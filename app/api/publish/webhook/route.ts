import { json } from "@/lib/http"
import { updateEasProject } from "@/lib/publish/app-identity"
import { getBuild, markFailed, markReady } from "@/lib/publish/builds"
import { verifyPublishWebhookSignature } from "@/lib/publish/webhook-auth"

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

  const buildId = typeof payload.buildId === "string" ? payload.buildId : ""
  if (!buildId) {
    return json({ error: "Missing buildId" }, 400)
  }

  const build = await getBuild(buildId)
  if (!build) {
    return json({ error: "Build not found" }, 404)
  }

  // Idempotency: if already in a terminal state, don't re-process, return 200 immediately
  if (build.status === "ready" || build.status === "failed") {
    return json({ ok: true, alreadyFinished: true }, 200)
  }

  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : ""
  const easBuildId = typeof payload.easBuildId === "string" ? payload.easBuildId : null
  const artifactUrl = typeof payload.artifactUrl === "string" ? payload.artifactUrl : null
  const workflowRunUrl = typeof payload.workflowRunUrl === "string" ? payload.workflowRunUrl : null
  const error = typeof payload.error === "string" ? payload.error : null
  const needsIosCredentials =
    Boolean(payload.needsIosCredentials) || Boolean(payload.iosCredentialsMissing) ? 1 : 0

  const easProjectId = typeof payload.easProjectId === "string" ? payload.easProjectId : null
  const expoOwner = typeof payload.expoOwner === "string" ? payload.expoOwner : null

  if (easProjectId || expoOwner) {
    await updateEasProject(build.projectId, { easProjectId, expoOwner }).catch(() => {})
  }

  if (status === "ready" && artifactUrl) {
    await markReady(buildId, {
      artifactUrl,
      easBuildId,
      workflowRunUrl,
    })
  } else {
    await markFailed(buildId, {
      error: error || (status === "ready" && !artifactUrl ? "Artifact URL missing from completed build" : "Build failed"),
      easBuildId,
      needsIosCredentials,
      workflowRunUrl,
    })
  }

  return json({ ok: true }, 200)
}
