import { cache } from "react"
import { notFound, redirect } from "next/navigation"
import { and, asc, eq } from "drizzle-orm"

import { db, messages, projects } from "@/db"
import { getCurrentUser } from "@/lib/current-user"
import { signedDownloadUrl } from "@/lib/storage"
import { toStoredMessage } from "@/lib/agent/orchestrator"
import type { AgentPhase } from "@/lib/agent/types"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { getBackend } from "@/lib/cloudhike/app-backend"
import { isConnectConfigured } from "@/lib/cloudhike/config"
import { hasConnection } from "@/lib/cloudhike/connect"
import { backendInfo } from "@/lib/cloudhike/provision"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import type { ChatMessage, WorkspaceProject } from "@/components/workspace/types"

export const dynamic = "force-dynamic"

const PHASES: AgentPhase[] = ["draft", "planning", "awaiting_approval", "generating", "ready"]
// Projects made before the agent existed may carry other statuses.
const normalizePhase = (s: string | null): AgentPhase => (PHASES.includes(s as AgentPhase) ? (s as AgentPhase) : "draft")

// Shared by generateMetadata and the page within one request.
const loadProject = cache(async (projectId: string) => {
  const user = await getCurrentUser()
  if (!user) redirect("/")
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  return project
})

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const project = await loadProject(projectId).catch(() => undefined)
  return { title: project ? `${project.name} — Anything` : "Workspace — Anything" }
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const project = await loadProject(projectId)
  if (!project) notFound()

  const [assets, history, backendRow, accountConnected] = await Promise.all([
    Promise.all(
      (project.assets ?? []).map(async (a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        size: a.size,
        url: await signedDownloadUrl(a.key).catch(() => null),
      }))
    ),
    db
      .select()
      .from(messages)
      .where(eq(messages.projectId, project.id))
      .orderBy(asc(messages.createdAt))
      .limit(200),
    getBackend(project.id).catch(() => null),
    project.userId ? hasConnection(project.userId).catch(() => false) : false,
  ])

  const doc = readAppDoc(project.previewScreens)
  const data: WorkspaceProject = {
    id: project.id,
    name: project.name,
    prompt: project.prompt ?? "",
    phase: normalizePhase(project.status),
    platform: project.platform,
    createdAt: project.createdAt.toISOString(),
    assets,
    screens: doc.screens,
    themes: doc.themes ?? null,
    dataModel: doc.data ?? null,
    files: doc.files ?? {},
    backend: doc.backend,
    backendInfo: backendInfo(backendRow),
    cloudhike: { configured: isConnectConfigured(), accountConnected },
    isPublic: project.isPublic,
    publicSlug: project.publicSlug,
  }

  // The project's attachments belong to the first prompt.
  const firstUser = history.findIndex((m) => m.sender === "user")
  const chat: ChatMessage[] = history.map((m, i) => ({
    ...toStoredMessage(m),
    assets: i === firstUser ? assets : undefined,
  }))

  return <WorkspaceShell project={data} initialMessages={chat} />
}
