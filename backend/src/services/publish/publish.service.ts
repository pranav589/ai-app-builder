import { and, eq } from "drizzle-orm"
import { db, projectGithubLinks, projects, webDeployRuns, type BuildFormat, type BuildPlatform } from "@/db"
import { GithubApiError } from "../github/api"
import { getAccess as getGithubAccess, markRevoked as markGithubRevoked } from "../github/connect"
import { cancelActiveBuild, createQueuedBuild, getActiveBuildForTarget, getBuild, listBuildsForProject, markFailed, markReady } from "./builds"
import {
  ExpoConnectError,
  forgetConnection,
  getAccess as getExpoAccess,
  getConnection as getExpoConnection,
  markRevoked as markExpoRevoked,
  saveToken,
} from "./expo-connect"
import { publishBuild } from "./run-publish"
import { runWebDeploy } from "./run-web-deploy"
import { cancelWebDeployment, claimWebDeployment, getWebDeployment, listWebDeployRuns, markWebBuilding, markWebDeploying, markWebFailed, markWebReady } from "./web-deploy"
import { updateEasProject } from "./app-identity"
import { verifyPublishWebhookSignature } from "./webhook-auth"

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

/** The connected GitHub token needs 'workflow' scope to dispatch an Actions build/deploy. */
function requireWorkflowScope(scope: string) {
  const scopes = scope.split(/[\s,]+/)
  if (!scopes.includes("workflow")) {
    throw Object.assign(
      new Error(
        "GitHub Actions workflow permission ('workflow' scope) is required to publish builds. Please reconnect your GitHub account in the Push dialog to grant workflow permissions."
      ),
      { status: 409, code: "github_workflow_scope_missing" }
    )
  }
}

/**
 * Awaits the actual publish/web-deploy dispatch (it was fire-and-forget here before, which
 * silently dropped this exact error mapping and the revoked-token bookkeeping -- the old
 * Next.js route awaited it too, for the same reason: the caller needs to know right away
 * whether the dispatch itself failed, not just that a build/run row was queued).
 */
async function runPublishAndMapErrors(userId: string, run: () => Promise<unknown>) {
  try {
    await run()
  } catch (err) {
    if (err instanceof GithubApiError) {
      if (err.status === 401 || err.code === "auth_expired") {
        await markGithubRevoked(userId)
        throw Object.assign(new Error("GitHub authorization has expired. Please reconnect GitHub."), {
          status: 401,
          code: "github_auth_expired",
        })
      }
      if (err.status === 404) {
        throw Object.assign(
          new Error("GitHub returned 404 Not Found. This usually occurs when GitHub token lacks the 'workflow' scope. Please reconnect GitHub in the Push dialog."),
          { status: 502, code: "github_not_found" }
        )
      }
      throw Object.assign(new Error(err.message), { status: 502, code: err.code || "github_error" })
    }
    throw Object.assign(new Error(err instanceof Error ? err.message : "Failed to publish build"), {
      status: 500,
      code: "publish_failed",
    })
  }
}

export async function saveExpoUserToken(userId: string, token: string) {
  return await saveToken(userId, token)
}

export async function getExpoUserStatus(userId?: string) {
  if (!userId) return { connected: false }
  const conn = await getExpoConnection(userId)
  return { connected: Boolean(conn), username: conn?.expoUsername || null }
}

export async function forgetExpoUserConnection(userId: string) {
  await forgetConnection(userId)
  return { ok: true }
}

export async function startProjectBuild(userId: string, projectId: string, body: any) {
  const platform = body?.platform as BuildPlatform
  if (platform !== "android" && platform !== "ios") {
    throw Object.assign(new Error("Platform must be 'android' or 'ios'."), { status: 400, code: "invalid_platform" })
  }

  const format = body?.format as BuildFormat
  if (platform === "android" && format !== "aab" && format !== "apk") {
    throw Object.assign(new Error("Android format must be 'aab' or 'apk'."), { status: 400, code: "invalid_format" })
  }
  if (platform === "ios" && format !== "ipa") {
    throw Object.assign(new Error("iOS format must be 'ipa'."), { status: 400, code: "invalid_format" })
  }

  const version = typeof body?.version === "string" ? body.version.trim() : ""
  if (!version || !SEMVER_REGEX.test(version)) {
    throw Object.assign(new Error("Version must be a valid semver string (e.g. 1.0.0)."), { status: 400, code: "invalid_version" })
  }

  const [project] = await db
    .select({ name: projects.name, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) throw Object.assign(new Error("Project not found."), { status: 404 })

  const [linked] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
    .limit(1)

  if (!linked) {
    throw Object.assign(new Error("Project is not linked to GitHub. Please push to GitHub first before publishing."), { status: 409, code: "not_linked" })
  }

  const githubAccess = await getGithubAccess(userId)
  if (!githubAccess) {
    throw Object.assign(new Error("GitHub account not connected or authorization expired."), { status: 409, code: "github_not_connected" })
  }
  requireWorkflowScope(githubAccess.scope)

  const expoAccess = await getExpoAccess(userId)
  if (!expoAccess) {
    throw Object.assign(new Error("Expo account not connected."), { status: 409, code: "expo_not_connected" })
  }

  const active = await getActiveBuildForTarget(projectId, platform, format)
  if (active) {
    throw Object.assign(new Error(`A ${platform.toUpperCase()} ${format.toUpperCase()} build is already in progress.`), { status: 409, code: "build_in_progress", buildId: active.id })
  }

  const buildId = crypto.randomUUID()
  const queuedBuild = await createQueuedBuild({
    id: buildId,
    projectId,
    userId,
    platform,
    format,
    version,
    repoOwner: linked.repoOwner,
    repoName: linked.repoName,
  })

  await runPublishAndMapErrors(userId, () =>
    publishBuild({
      projectId,
      userId,
      projectName: project.name,
      previewScreens: project.previewScreens,
      buildId: queuedBuild.id,
      platform,
      format,
      version,
      repoOwner: linked.repoOwner,
      repoName: linked.repoName,
      githubToken: githubAccess.token,
      expoToken: expoAccess.token,
    })
  )

  return { ok: true, buildId: queuedBuild.id }
}

export async function listBuilds(userId: string, projectId: string) {
  const builds = await listBuildsForProject(projectId)
  return { builds }
}

export async function retryBuild(userId: string, projectId: string, buildId: string) {
  const failedBuild = await getBuild(buildId)
  if (!failedBuild || failedBuild.projectId !== projectId) {
    throw Object.assign(new Error("Build not found."), { status: 404, code: "not_found" })
  }
  if (failedBuild.status !== "failed") {
    throw Object.assign(new Error("Only failed builds can be retried."), { status: 409, code: "conflict" })
  }

  let repoOwner = failedBuild.repoOwner
  let repoName = failedBuild.repoName
  if (!repoOwner || !repoName) {
    const [linked] = await db
      .select()
      .from(projectGithubLinks)
      .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
      .limit(1)
    if (linked) {
      repoOwner = linked.repoOwner
      repoName = linked.repoName
    }
  }

  if (!repoOwner || !repoName) {
    throw Object.assign(new Error("Repository link missing."), { status: 409, code: "not_linked" })
  }

  const githubAccess = await getGithubAccess(userId)
  if (!githubAccess) {
    throw Object.assign(new Error("GitHub account not connected."), { status: 409, code: "github_not_connected" })
  }
  requireWorkflowScope(githubAccess.scope)
  const expoAccess = await getExpoAccess(userId)
  if (!expoAccess) {
    throw Object.assign(new Error("Expo account not connected."), { status: 409, code: "expo_not_connected" })
  }

  const [project] = await db
    .select({ name: projects.name, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) throw Object.assign(new Error("Project not found."), { status: 404 })

  const newBuildId = crypto.randomUUID()
  const queuedBuild = await createQueuedBuild({
    id: newBuildId,
    projectId,
    userId,
    platform: failedBuild.platform,
    format: failedBuild.format,
    version: failedBuild.version || "1.0.0",
    repoOwner,
    repoName,
  })

  await runPublishAndMapErrors(userId, () =>
    publishBuild({
      projectId,
      userId,
      projectName: project.name,
      previewScreens: project.previewScreens,
      buildId: queuedBuild.id,
      platform: failedBuild.platform,
      format: failedBuild.format,
      version: failedBuild.version || "1.0.0",
      repoOwner,
      repoName,
      githubToken: githubAccess.token,
      expoToken: expoAccess.token,
    })
  )

  return { ok: true, buildId: queuedBuild.id }
}

export async function getWebDeploymentStatus(userId: string, projectId: string) {
  const deployment = await getWebDeployment(projectId)
  const runs = await listWebDeployRuns(projectId)
  return { deployment, runs }
}

export async function triggerWebDeployment(userId: string, projectId: string) {
  const [project] = await db
    .select({ name: projects.name, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) throw Object.assign(new Error("Project not found."), { status: 404 })

  const [linked] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
    .limit(1)

  if (!linked) {
    throw Object.assign(new Error("Project is not linked to GitHub. Please push to GitHub first before publishing."), { status: 409, code: "not_linked" })
  }

  const githubAccess = await getGithubAccess(userId)
  if (!githubAccess) {
    throw Object.assign(new Error("GitHub account not connected or authorization expired."), { status: 409, code: "github_not_connected" })
  }
  requireWorkflowScope(githubAccess.scope)

  const expoAccess = await getExpoAccess(userId)
  if (!expoAccess) {
    throw Object.assign(new Error("Expo account not connected."), { status: 409, code: "expo_not_connected" })
  }

  const claim = await claimWebDeployment({
    projectId,
    userId,
    repoOwner: linked.repoOwner,
    repoName: linked.repoName,
  })
  if (!claim.ok) {
    throw Object.assign(new Error("A web deployment is already in progress."), { status: 409, code: "deploy_in_progress" })
  }

  await runPublishAndMapErrors(userId, () =>
    runWebDeploy({
      projectId,
      runId: claim.runId,
      userId,
      projectName: project.name,
      previewScreens: project.previewScreens,
      expoToken: expoAccess.token,
      githubToken: githubAccess.token,
      repoOwner: linked.repoOwner,
      repoName: linked.repoName,
    })
  )

  return { ok: true, deployment: claim.deployment }
}

export async function handlePublishWebhookEvent(rawBody: string, sigHeader: string | null) {
  if (!verifyPublishWebhookSignature(rawBody, sigHeader)) {
    throw Object.assign(new Error("Invalid webhook signature"), { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 })
  }

  const buildId = typeof payload.buildId === "string" ? payload.buildId : ""
  if (!buildId) throw Object.assign(new Error("Missing buildId"), { status: 400 })

  const build = await getBuild(buildId)
  if (!build) throw Object.assign(new Error("Build not found"), { status: 404 })

  if (build.status === "ready" || build.status === "failed") {
    return { ok: true, alreadyFinished: true }
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
    return { ok: true, status: "ready" }
  } else {
    await markFailed(buildId, {
      error: error || (status === "ready" && !artifactUrl ? "Artifact URL missing from completed build" : "Build failed"),
      easBuildId,
      needsIosCredentials,
      workflowRunUrl,
    })
    return { ok: true, status: "failed" }
  }
}

export async function handleWebWebhookEvent(rawBody: string, sigHeader: string | null) {
  if (!verifyPublishWebhookSignature(rawBody, sigHeader)) {
    throw Object.assign(new Error("Invalid webhook signature"), { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 })
  }

  const projectId = typeof payload.projectId === "string" ? payload.projectId : ""
  const runId = typeof payload.runId === "string" ? payload.runId : ""
  if (!projectId || !runId) {
    throw Object.assign(new Error("Missing projectId or runId"), { status: 400 })
  }

  const [run] = await db.select().from(webDeployRuns).where(eq(webDeployRuns.id, runId)).limit(1)
  if (!run) throw Object.assign(new Error("Deploy run not found"), { status: 404 })

  const easProjectId = typeof payload.easProjectId === "string" ? payload.easProjectId : null
  const expoOwner = typeof payload.expoOwner === "string" ? payload.expoOwner : null
  if (easProjectId || expoOwner) {
    await updateEasProject(projectId, { easProjectId, expoOwner }).catch(() => {})
  }

  const stage = typeof payload.stage === "string" ? payload.stage.toLowerCase() : ""
  if (stage === "building") {
    await markWebBuilding(projectId, runId)
    return { ok: true, stage: "building" }
  }
  if (stage === "deploying") {
    await markWebDeploying(projectId, runId)
    return { ok: true, stage: "deploying" }
  }

  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : ""
  const url = typeof payload.url === "string" ? payload.url : null
  const error = typeof payload.error === "string" ? payload.error : null
  const workflowRunUrl = typeof payload.workflowRunUrl === "string" ? payload.workflowRunUrl : null

  if (status === "ready" && url) {
    await markWebReady(projectId, runId, { url, workflowRunUrl })
    return { ok: true, status: "ready", url }
  } else {
    await markWebFailed(
      projectId,
      runId,
      error || (status === "ready" && !url ? "Deployment completed but no live URL was returned" : "Web deployment failed"),
      { workflowRunUrl }
    )
    return { ok: true, status: "failed" }
  }
}


const STOPPED = "Stopped by you."

export async function stopBuild(projectId: string, buildId: string) {
  const build = await getBuild(buildId)
  if (!build || build.projectId !== projectId) {
    throw Object.assign(new Error("Build not found."), { status: 404, code: "not_found" })
  }
  if (!(await cancelActiveBuild(buildId, STOPPED))) {
    throw Object.assign(new Error("This build is not running."), { status: 409, code: "not_running" })
  }
  return { ok: true }
}

export async function stopWebDeployment(projectId: string) {
  if (!(await cancelWebDeployment(projectId, STOPPED))) {
    throw Object.assign(new Error("No web deployment is running."), { status: 409, code: "not_running" })
  }
  return { ok: true }
}
