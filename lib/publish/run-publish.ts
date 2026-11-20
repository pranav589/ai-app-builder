import { and, eq } from "drizzle-orm"
import {
  builds,
  db,
  projectGithubLinks,
  type BuildFormat,
  type BuildPlatform,
} from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { buildExportFileMap } from "@/lib/app-project/zip-export"
import { dispatchWorkflow, getRepo, listWorkflowRuns } from "@/lib/github/api"
import { pushProject } from "@/lib/github/push"
import { workspaceFromDoc } from "@/lib/verify/workspace"
import { ensureAppIdentity } from "./app-identity"
import { markDispatched, markFailed } from "./builds"
import {
  buildEasJson,
  buildReportScript,
  buildWorkflowYaml,
  patchAppJsonForPublish,
  profileName,
} from "./eas-config"
import { upsertRepoSecret } from "./github-secrets"

export type PublishBuildOptions = {
  projectId: string
  userId: string
  projectName: string
  previewScreens: unknown
  buildId: string
  platform: BuildPlatform
  format: BuildFormat
  version: string
  expoToken: string
  githubToken: string
  repoOwner: string
  repoName: string
}

async function correlateWorkflowRun(
  githubToken: string,
  owner: string,
  repo: string,
  workflowId: string,
  buildId: string
) {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const res = await listWorkflowRuns(githubToken, owner, repo, workflowId, {
        event: "workflow_dispatch",
      })
      if (res.workflow_runs && res.workflow_runs.length > 0) {
        const newest = res.workflow_runs[0]
        const runAgeMs = Date.now() - new Date(newest.created_at).getTime()
        if (runAgeMs < 120_000) {
          await db
            .update(builds)
            .set({
              workflowRunId: String(newest.id),
              workflowRunUrl: newest.html_url,
            })
            .where(eq(builds.id, buildId))
          break
        }
      }
    } catch {
      // Best-effort correlation; ignore errors
    }
  }
}

export async function publishBuild(opts: PublishBuildOptions): Promise<void> {
  const {
    projectId,
    userId,
    projectName,
    previewScreens,
    buildId,
    platform,
    format,
    version,
    expoToken,
    githubToken,
    repoOwner,
    repoName,
  } = opts

  try {
    const doc = readAppDoc(previewScreens)
    const { files } = workspaceFromDoc(doc)
    const appJsonText = files["app.json"] || ""

    const identity = await ensureAppIdentity(projectId, appJsonText)

    const exportFiles = buildExportFileMap(projectName, files)
    exportFiles["app.json"] = patchAppJsonForPublish(
      exportFiles["app.json"] || appJsonText,
      identity,
      version
    )
    exportFiles["eas.json"] = buildEasJson()
    exportFiles[".github/workflows/eas-build.yml"] = buildWorkflowYaml()

    const webhookUrl =
      process.env.PUBLISH_WEBHOOK_URL ||
      (process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/publish/webhook`
        : "http://localhost:3000/api/publish/webhook")
    exportFiles[".github/scripts/report-build.js"] = buildReportScript({ webhookUrl })

    const [linked] = await db
      .select()
      .from(projectGithubLinks)
      .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
      .limit(1)

    // Builds are dispatched on the repository's default branch, since workflow_dispatch
    // requires the workflow file to exist there.
    let targetBranch = "main"
    try {
      const repoInfo = await getRepo(githubToken, repoOwner, repoName)
      if (repoInfo.default_branch) targetBranch = repoInfo.default_branch
    } catch {}

    const commitMsg = `Publish ${platform.toUpperCase()} ${format.toUpperCase()} v${version}`
    const pushResult = await pushProject(githubToken, {
      target: { kind: "existing", owner: repoOwner, name: repoName },
      branch: { mode: "new", name: targetBranch },
      message: commitMsg,
      files: exportFiles,
      linked,
    })

    await db
      .insert(projectGithubLinks)
      .values({
        projectId,
        userId,
        repoOwner: pushResult.owner,
        repoName: pushResult.name,
        lastBranch: pushResult.branch,
        lastCommitSha: pushResult.commitSha,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: projectGithubLinks.projectId,
        set: {
          userId,
          repoOwner: pushResult.owner,
          repoName: pushResult.name,
          lastBranch: pushResult.branch,
          lastCommitSha: pushResult.commitSha,
          updatedAt: new Date(),
        },
      })

    const webhookSecret = process.env.PUBLISH_WEBHOOK_SECRET || ""
    if (!webhookSecret) {
      throw new Error("PUBLISH_WEBHOOK_SECRET is not configured on server.")
    }

    await upsertRepoSecret(githubToken, repoOwner, repoName, "EXPO_TOKEN", expoToken)
    await upsertRepoSecret(githubToken, repoOwner, repoName, "PUBLISH_WEBHOOK_SECRET", webhookSecret)

    // pushResult.branch is always the repo's default branch (targetBranch above), which is
    // exactly where workflow_dispatch needs the workflow file to live — nothing further to sync.
    // Give GitHub Actions a moment to index the just-committed/updated workflow file before dispatching.
    await new Promise((r) => setTimeout(r, 2000))

    const profile = profileName(platform, format)
    await dispatchWorkflow(githubToken, repoOwner, repoName, "eas-build.yml", pushResult.branch, {
      build_id: buildId,
      platform,
      format,
      profile,
    })

    await markDispatched(buildId, {})

    void correlateWorkflowRun(githubToken, repoOwner, repoName, "eas-build.yml", buildId)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await markFailed(buildId, { error })
    throw err
  }
}
