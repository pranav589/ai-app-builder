import { and, eq } from "drizzle-orm"
import { db, projectGithubLinks } from "@/db"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { GithubApiError } from "@/lib/github/api"
import { getAccess as getGithubAccess, markRevoked as markGithubRevoked } from "@/lib/github/connect"
import { isSameOriginJson, json } from "@/lib/http"
import { getAccess as getExpoAccess } from "@/lib/publish/expo-connect"
import { runWebDeploy } from "@/lib/publish/run-web-deploy"
import { claimWebDeployment, getWebDeployment, listWebDeployRuns } from "@/lib/publish/web-deploy"

export const runtime = "nodejs"

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

  // 4. Atomic claim for web deployment
  const claimResult = await claimWebDeployment({
    projectId,
    userId: owned.user.id,
    repoOwner: linked.repoOwner,
    repoName: linked.repoName,
  })

  if (!claimResult.ok) {
    return json(
      {
        error: "deploy_in_progress",
        message: "A web deployment is already in progress.",
      },
      409
    )
  }

  // 5. Execute web deploy
  try {
    await runWebDeploy({
      projectId,
      runId: claimResult.runId,
      userId: owned.user.id,
      projectName: owned.project.name,
      previewScreens: owned.project.previewScreens,
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
        message: err instanceof Error ? err.message : "Failed to publish web deployment",
      },
      500
    )
  }

  return json({ ok: true, deployment: claimResult.deployment }, 200)
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const [deployment, runs] = await Promise.all([
    getWebDeployment(projectId),
    listWebDeployRuns(projectId),
  ])
  return json({ deployment, runs }, 200)
}
