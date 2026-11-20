import { and, eq } from "drizzle-orm"

import { db, projectGithubLinks } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { buildExportFileMap } from "@/lib/app-project/zip-export"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { defaultCommitMessage } from "@/lib/github/push"
import { json } from "@/lib/http"
import { workspaceFromDoc } from "@/lib/verify/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const [link] = await db
    .select()
    .from(projectGithubLinks)
    .where(and(eq(projectGithubLinks.projectId, projectId), eq(projectGithubLinks.userId, owned.user.id)))
    .limit(1)

  const doc = readAppDoc(owned.project.previewScreens)
  const { files } = workspaceFromDoc(doc)
  const exportFiles = buildExportFileMap(owned.project.name, files)
  const fileCount = Object.keys(exportFiles).length
  const isFirstPush = !link
  const suggestedMessage = defaultCommitMessage(fileCount, owned.project.name, isFirstPush)

  return json({
    link: link ?? null,
    suggestedMessage,
  })
}
