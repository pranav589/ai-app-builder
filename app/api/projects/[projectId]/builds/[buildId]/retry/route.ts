import { and, eq } from "drizzle-orm"
import { db, projectGithubLinks } from "@/db"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { GithubApiError } from "@/lib/github/api"
import { getAccess as getGithubAccess, markRevoked as markGithubRevoked } from "@/lib/github/connect"
import { isSameOriginJson, json } from "@/lib/http"
import { createQueuedBuild, getActiveBuildForTarget, getBuild } from "@/lib/publish/builds"
import { getAccess as getExpoAccess } from "@/lib/publish/expo-connect"
import { publishBuild } from "@/lib/publish/run-publish"

export const runtime = "nodejs"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; buildId: string }> }
) {
  if (!isSameOriginJson(req)) {
    return json({ error: "Invalid request origin or content type." }, 400)
  }

  const { projectId, buildId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const failedBuild = await getBuild(buildId)
  if (!failedBuild || failedBuild.projectId !== projectId) {
    return json({ error: "not_found", message: "Build not found." }, 404)
  }

  if (failedBuild.status !== "failed") {
    return json({ error: "conflict", message: "Only failed builds can be retried." }, 409)
  }

  // 1. Resolve repository
  let repoOwner = failedBuild.repoOwner
  let repoName = failedBuild.repoName

  if (!repoOwner || !repoName) {
    const [linked] = await db
      .select()
      .from(projectGithubLinks)
      .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, owned.user.id)))
      .limit(1)

    if (linked) {
      repoOwner = linked.repoOwner
      repoName = linked.repoName
    }
  }

  if (!repoOwner || !repoName) {
    return json(
      {
        error: "not_linked",
        message: "Repository information missing. Please push to GitHub first.",
      },
      409
    )
  }

  // 2. Check GitHub access
  const githubAccess = await getGithubAccess(owned.user.id)
  if (!githubAccess) {
    return json(
      {
        error: "github_not_connected",
        message: "GitHub account not connected or authorization expired.",
      },
      409
    )
  }

  const scopes = githubAccess.scope.split(/[\s,]+/)
  if (!scopes.includes("workflow")) {
    return json(
      {
        error: "github_workflow_scope_missing",
        message:
          "GitHub Actions workflow permission ('workflow' scope) is required to publish builds. Please reconnect your GitHub account in the Push dialog to grant workflow permissions.",
      },
      409
    )
  }

  // 3. Check Expo connection (fresh check - fail if token was rotated/revoked)
  const expoAccess = await getExpoAccess(owned.user.id)
  if (!expoAccess) {
    return json(
      {
        error: "expo_not_connected",
        message: "Expo account not connected. Please connect your Expo personal access token.",
      },
      409
    )
  }

  // 4. Pre-check for active build
  const activeBuild = await getActiveBuildForTarget(projectId, failedBuild.platform, failedBuild.format)
  if (activeBuild) {
    return json(
      {
        error: "build_in_progress",
        message: `A build for ${failedBuild.platform} (${failedBuild.format}) is already in progress.`,
      },
      409
    )
  }

  // 5. Insert new build row (retry never mutates finished row)
  const newBuildId = crypto.randomUUID()
  let queuedBuild
  try {
    queuedBuild = await createQueuedBuild({
      id: newBuildId,
      projectId,
      userId: owned.user.id,
      platform: failedBuild.platform,
      format: failedBuild.format,
      version: failedBuild.version,
      repoOwner,
      repoName,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("builds_one_active_per_target") || msg.includes("unique")) {
      return json(
        {
          error: "build_in_progress",
          message: `A build for ${failedBuild.platform} (${failedBuild.format}) is already in progress.`,
        },
        409
      )
    }
    throw err
  }

  // 6. Execute publish
  try {
    await publishBuild({
      projectId,
      userId: owned.user.id,
      projectName: owned.project.name,
      previewScreens: owned.project.previewScreens,
      buildId: queuedBuild.id,
      platform: failedBuild.platform,
      format: failedBuild.format,
      version: failedBuild.version,
      expoToken: expoAccess.token,
      githubToken: githubAccess.token,
      repoOwner,
      repoName,
    })
  } catch (err) {
    if (err instanceof GithubApiError) {
      if (err.status === 401 || err.code === "auth_expired") {
        await markGithubRevoked(owned.user.id)
        return json(
          {
            error: "github_auth_expired",
            message: "GitHub authorization has expired. Please reconnect GitHub.",
          },
          401
        )
      }
      if (err.status === 404) {
        return json(
          {
            error: "github_not_found",
            message:
              "GitHub returned 404 Not Found. This usually occurs when GitHub token lacks the 'workflow' scope. Please reconnect GitHub in the Push dialog.",
          },
          502
        )
      }
      return json({ error: err.code || "github_error", message: err.message }, 502)
    }
    return json(
      {
        error: "publish_failed",
        message: err instanceof Error ? err.message : "Failed to publish build retry",
      },
      500
    )
  }

  return json({ buildId: queuedBuild.id }, 200)
}
