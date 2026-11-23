import { db, projectGithubLinks, type ProjectGithubLinkRow } from "@/db"
import { dispatchWorkflow, getRepo, listWorkflowRuns } from "@/lib/github/api"
import { pushProject } from "@/lib/github/push"
import { upsertRepoSecret } from "./github-secrets"

export async function correlateWorkflowRun(
  githubToken: string,
  owner: string,
  repo: string,
  workflowId: string,
  onCorrelated: (runId: string, runUrl: string) => Promise<void>
): Promise<void> {
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
          await onCorrelated(String(newest.id), newest.html_url)
          break
        }
      }
    } catch {
      // Best-effort correlation; ignore errors
    }
  }
}

export async function dispatchProjectWorkflow(opts: {
  githubToken: string
  expoToken: string
  repoOwner: string
  repoName: string
  linked: ProjectGithubLinkRow | undefined
  exportFiles: Record<string, string>
  commitMessage: string
  workflowFileName: string
  workflowInputs: Record<string, string>
  onDispatched: (info: { workflowRunId?: string | null; workflowRunUrl?: string | null }) => Promise<void>
  onFailed: (error: string) => Promise<void>
  onCorrelated?: (runId: string, runUrl: string) => Promise<void>
}): Promise<{ pushResult: Awaited<ReturnType<typeof pushProject>> }> {
  try {
    let targetBranch = "main"
    try {
      const repoInfo = await getRepo(opts.githubToken, opts.repoOwner, opts.repoName)
      if (repoInfo.default_branch) targetBranch = repoInfo.default_branch
    } catch {}

    const pushResult = await pushProject(opts.githubToken, {
      target: { kind: "existing", owner: opts.repoOwner, name: opts.repoName },
      branch: { mode: "new", name: targetBranch },
      message: opts.commitMessage,
      files: opts.exportFiles,
      linked: opts.linked,
    })

    if (opts.linked?.projectId && opts.linked?.userId) {
      await db
        .insert(projectGithubLinks)
        .values({
          projectId: opts.linked.projectId,
          userId: opts.linked.userId,
          repoOwner: pushResult.owner,
          repoName: pushResult.name,
          lastBranch: pushResult.branch,
          lastCommitSha: pushResult.commitSha,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: projectGithubLinks.projectId,
          set: {
            userId: opts.linked.userId,
            repoOwner: pushResult.owner,
            repoName: pushResult.name,
            lastBranch: pushResult.branch,
            lastCommitSha: pushResult.commitSha,
            updatedAt: new Date(),
          },
        })
    }

    const webhookSecret = process.env.PUBLISH_WEBHOOK_SECRET || ""
    if (!webhookSecret) {
      throw new Error("PUBLISH_WEBHOOK_SECRET is not configured on server.")
    }

    await upsertRepoSecret(opts.githubToken, opts.repoOwner, opts.repoName, "EXPO_TOKEN", opts.expoToken)
    await upsertRepoSecret(opts.githubToken, opts.repoOwner, opts.repoName, "PUBLISH_WEBHOOK_SECRET", webhookSecret)

    // Give GitHub Actions a moment to index the just-committed/updated workflow file before dispatching.
    await new Promise((r) => setTimeout(r, 2000))

    await dispatchWorkflow(
      opts.githubToken,
      opts.repoOwner,
      opts.repoName,
      opts.workflowFileName,
      pushResult.branch,
      opts.workflowInputs
    )

    await opts.onDispatched({})

    const onCorrelate =
      opts.onCorrelated ||
      (async (runId: string, runUrl: string) => {
        await opts.onDispatched({ workflowRunId: runId, workflowRunUrl: runUrl })
      })

    void correlateWorkflowRun(
      opts.githubToken,
      opts.repoOwner,
      opts.repoName,
      opts.workflowFileName,
      onCorrelate
    )

    return { pushResult }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await opts.onFailed(error)
    throw err
  }
}
