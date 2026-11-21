import { and, eq } from "drizzle-orm"
import { db, projectGithubLinks, projects } from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { buildExportFileMap } from "../app-project/zip-export"
import { defaultCommitMessage, pushProject, type PushBranch, type PushTarget } from "./push"
import { getAccess, getConnection, markRevoked } from "./connect"
import { GithubApiError, listRepos } from "./api"
import { isConnectConfigured } from "./config"
import { workspaceFromDoc } from "../verify/workspace"
import { sseEvent } from "../http/sse"

export async function getGithubConfigAndStatus(userId?: string) {
  const configured = isConnectConfigured()
  if (!configured || !userId) {
    return { configured, connected: false }
  }
  const conn = await getConnection(userId)
  return {
    configured: true,
    connected: Boolean(conn),
    login: conn?.login,
  }
}

export async function listReposForUser(userId: string) {
  const access = await getAccess(userId)
  if (!access) throw Object.assign(new Error("reconnect"), { status: 401 })

  try {
    const repos = await listRepos(access.token)
    return { repos }
  } catch (err) {
    if (err instanceof GithubApiError && (err.status === 401 || err.code === "auth_expired")) {
      await markRevoked(userId)
      throw Object.assign(new Error("reconnect"), { status: 401 })
    }
    if (err instanceof GithubApiError && err.code === "rate_limited") {
      throw Object.assign(new Error(err.message), { status: 403, code: "rate_limited" })
    }
    throw err
  }
}

export async function getProjectGithubInfo(userId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) return null

  const [link] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
    .limit(1)

  const doc = readAppDoc(project.previewScreens)
  const { files } = workspaceFromDoc(doc)
  const exportFiles = await buildExportFileMap(projectId, project.name, files, { selfHost: true })
  const fileCount = Object.keys(exportFiles).length
  const isFirstPush = !link
  const suggestedMessage = defaultCommitMessage(fileCount, project.name, isFirstPush)

  return {
    link: link ?? null,
    suggestedMessage,
  }
}

export async function streamPushProject(
  userId: string,
  projectId: string,
  body: any,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const access = await getAccess(userId)
  if (!access) throw Object.assign(new Error("GitHub account not connected."), { status: 409, code: "not_connected" })

  const targetRaw = body?.target
  if (!targetRaw || (targetRaw.kind !== "create" && targetRaw.kind !== "existing")) {
    throw Object.assign(new Error("Invalid repository target."), { status: 400 })
  }

  let target: PushTarget
  if (targetRaw.kind === "create") {
    const name = typeof targetRaw.name === "string" ? targetRaw.name.trim() : ""
    if (!name) throw Object.assign(new Error("Repository name is required."), { status: 400 })
    target = { kind: "create", name, private: Boolean(targetRaw.private) }
  } else {
    const owner = typeof targetRaw.owner === "string" ? targetRaw.owner.trim() : ""
    const name = typeof targetRaw.name === "string" ? targetRaw.name.trim() : ""
    if (!owner || !name) throw Object.assign(new Error("Repository owner and name are required."), { status: 400 })
    target = { kind: "existing", owner, name }
  }

  const branchRaw = body?.branch
  const branch: PushBranch =
    branchRaw?.mode === "new" && typeof branchRaw.name === "string" && branchRaw.name.trim()
      ? { mode: "new", name: branchRaw.name.trim() }
      : { mode: "existing" }

  const message = typeof body?.message === "string" && body.message.trim() ? body.message.trim() : "Update from Anything"

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) throw Object.assign(new Error("Project not found."), { status: 404 })

  const [linked] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, userId)))
    .limit(1)

  const doc = readAppDoc(project.previewScreens)
  const { files } = workspaceFromDoc(doc)
  const exportFiles = await buildExportFileMap(projectId, project.name, files, { selfHost: true })

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = await pushProject(access.token, {
          target,
          branch,
          message,
          files: exportFiles,
          linked,
          onProgress: (step) => {
            controller.enqueue(sseEvent({ type: "step", step }))
          },
        })

        await db
          .insert(projectGithubLinks)
          .values({
            projectId,
            userId,
            repoOwner: result.owner,
            repoName: result.name,
            lastBranch: result.branch,
            lastCommitSha: result.commitSha,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: projectGithubLinks.projectId,
            set: {
              userId,
              repoOwner: result.owner,
              repoName: result.name,
              lastBranch: result.branch,
              lastCommitSha: result.commitSha,
              updatedAt: new Date(),
            },
          })

        controller.enqueue(
          sseEvent({
            type: "done",
            owner: result.owner,
            name: result.name,
            branch: result.branch,
            commitSha: result.commitSha,
            htmlUrl: result.htmlUrl,
          })
        )
      } catch (err) {
        if (err instanceof GithubApiError) {
          let code = err.code || "push_failed"
          if (err.status === 401 || err.code === "auth_expired") {
            code = "auth_expired"
            await markRevoked(userId)
          } else if (err.status === 403 || err.code === "rate_limited") {
            code = "rate_limited"
          } else if (err.code === "name_conflict" || (err.status === 422 && err.message.toLowerCase().includes("already exists"))) {
            code = "name_conflict"
          }
          controller.enqueue(sseEvent({ type: "error", code, message: err.message }))
        } else {
          controller.enqueue(
            sseEvent({
              type: "error",
              code: "unknown_error",
              message: err instanceof Error ? err.message : "Push failed unexpectedly.",
            })
          )
        }
      } finally {
        controller.close()
      }
    },
  })
}
