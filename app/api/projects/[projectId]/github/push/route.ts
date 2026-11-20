import { and, eq } from "drizzle-orm"

import { db, projectGithubLinks } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { buildExportFileMap } from "@/lib/app-project/zip-export"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { GithubApiError } from "@/lib/github/api"
import { getAccess, markRevoked } from "@/lib/github/connect"
import {
  pushProject,
  type PushBranch,
  type PushTarget,
} from "@/lib/github/push"
import { isSameOriginJson, json, readJson } from "@/lib/http"
import { sseEvent, sseHeaders } from "@/lib/http/sse"
import { workspaceFromDoc } from "@/lib/verify/workspace"

export const runtime = "nodejs"

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) {
    return json({ error: "Invalid request origin or content type." }, 400)
  }

  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const access = await getAccess(owned.user.id)
  if (!access) {
    return json({ error: "not_connected", message: "GitHub account not connected." }, 409)
  }

  const body = await readJson(req)
  if (!body) return json({ error: "Invalid JSON body." }, 400)

  const targetRaw = body.target as Record<string, unknown> | undefined
  if (!targetRaw || (targetRaw.kind !== "create" && targetRaw.kind !== "existing")) {
    return json({ error: "Invalid repository target." }, 400)
  }

  let target: PushTarget
  if (targetRaw.kind === "create") {
    const name = typeof targetRaw.name === "string" ? targetRaw.name.trim() : ""
    if (!name) return json({ error: "Repository name is required." }, 400)
    target = { kind: "create", name, private: Boolean(targetRaw.private) }
  } else {
    const owner = typeof targetRaw.owner === "string" ? targetRaw.owner.trim() : ""
    const name = typeof targetRaw.name === "string" ? targetRaw.name.trim() : ""
    if (!owner || !name) return json({ error: "Repository owner and name are required." }, 400)
    target = { kind: "existing", owner, name }
  }

  const branchRaw = body.branch as Record<string, unknown> | undefined
  if (!branchRaw || (branchRaw.mode !== "existing" && branchRaw.mode !== "new")) {
    return json({ error: "Invalid branch specification." }, 400)
  }

  let branch: PushBranch
  if (branchRaw.mode === "new") {
    const name = typeof branchRaw.name === "string" ? branchRaw.name.trim() : ""
    if (!name) return json({ error: "Branch name is required." }, 400)
    branch = { mode: "new", name }
  } else {
    branch = { mode: "existing" }
  }

  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : "Update project files"

  const doc = readAppDoc(owned.project.previewScreens)
  const { files } = workspaceFromDoc(doc)
  const exportFiles = buildExportFileMap(owned.project.name, files)

  const [linked] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, owned.user.id)))
    .limit(1)

  const stream = new ReadableStream<Uint8Array>({
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
            userId: owned.user.id,
            repoOwner: result.owner,
            repoName: result.name,
            lastBranch: result.branch,
            lastCommitSha: result.commitSha,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: projectGithubLinks.projectId,
            set: {
              userId: owned.user.id,
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
            await markRevoked(owned.user.id)
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
              code: "push_failed",
              message: err instanceof Error ? err.message : "Push to GitHub failed",
            })
          )
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders })
}
