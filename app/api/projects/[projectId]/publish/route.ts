import { and, eq } from "drizzle-orm"
import { db, projectGithubLinks, type BuildFormat, type BuildPlatform } from "@/db"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { GithubApiError } from "@/lib/github/api"
import { getAccess as getGithubAccess, markRevoked as markGithubRevoked } from "@/lib/github/connect"
import { isSameOriginJson, json, readJson } from "@/lib/http"
import { createQueuedBuild, getActiveBuildForTarget } from "@/lib/publish/builds"
import { getAccess as getExpoAccess, markRevoked as markExpoRevoked } from "@/lib/publish/expo-connect"
import { publishBuild } from "@/lib/publish/run-publish"

export const runtime = "nodejs"

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  if (!isSameOriginJson(req)) {
    return json({ error: "Invalid request origin or content type." }, 400)
  }

  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const body = await readJson(req)

  if (!body) return json({ error: "Invalid JSON body." }, 400)

  const platform = body.platform as BuildPlatform
  if (platform !== "android" && platform !== "ios") {
    return json({ error: "invalid_platform", message: "Platform must be 'android' or 'ios'." }, 400)
  }

  const format = body.format as BuildFormat
  if (platform === "android" && format !== "aab" && format !== "apk") {
    return json({ error: "invalid_format", message: "Android format must be 'aab' or 'apk'." }, 400)
  }
  if (platform === "ios" && format !== "ipa") {
    return json({ error: "invalid_format", message: "iOS format must be 'ipa'." }, 400)
  }

  const version = typeof body.version === "string" ? body.version.trim() : ""
  if (!version || !SEMVER_REGEX.test(version)) {
    return json({ error: "invalid_version", message: "Version must be a valid semver string (e.g. 1.0.0)." }, 400)
  }

  // 1. Require GitHub link exists
  const [linked] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, owned.user.id)))
    .limit(1)

  if (!linked) {
    return json(
      {
        error: "not_linked",
        message: "Project is not linked to GitHub. Please push to GitHub first before publishing.",
      },
      409
    )
  }

  // 2. Require GitHub account connected
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

  // 3. Require Expo connection
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

  // 4. Pre-check for existing in-flight build
  const activeBuild = await getActiveBuildForTarget(projectId, platform, format)
  if (activeBuild) {
    return json(
      {
        error: "build_in_progress",
        message: `A build for ${platform} (${format}) is already in progress.`,
      },
      409
    )
  }

  // 5. Insert queued build row
  const buildId = crypto.randomUUID()
  let queuedBuild
  try {
    queuedBuild = await createQueuedBuild({
      id: buildId,
      projectId,
      userId: owned.user.id,
      platform,
      format,
      version,
      repoOwner: linked.repoOwner,
      repoName: linked.repoName,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("builds_one_active_per_target") || msg.includes("unique")) {
      return json(
        {
          error: "build_in_progress",
          message: `A build for ${platform} (${format}) is already in progress.`,
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
      platform,
      format,
      version,
      expoToken: expoAccess.token,
      githubToken: githubAccess.token,
      repoOwner: linked.repoOwner,
      repoName: linked.repoName,
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
        message: err instanceof Error ? err.message : "Failed to publish build",
      },
      500
    )
  }

  return json({ buildId: queuedBuild.id }, 200)
}
