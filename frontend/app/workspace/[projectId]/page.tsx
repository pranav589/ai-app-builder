import { cache } from "react"
import { notFound, redirect } from "next/navigation"
import { serverFetch } from "@/lib/server-api"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import type { ChatMessage, WorkspaceProject } from "@/components/workspace/types"

export const dynamic = "force-dynamic"

type WorkspaceData = {
  project: WorkspaceProject
  messages: ChatMessage[]
}

const loadWorkspace = cache(async (projectId: string) => {
  const res = await serverFetch<WorkspaceData>(`/api/projects/${encodeURIComponent(projectId)}/workspace`)
  if (res.status === 401) redirect("/")
  if (!res.ok || !res.data) return null
  return res.data
})

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const data = await loadWorkspace(projectId).catch(() => null)
  return { title: data?.project ? `${data.project.name} — Anything` : "Workspace — Anything" }
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const data = await loadWorkspace(projectId)
  if (!data) notFound()

  return <WorkspaceShell project={data.project} initialMessages={data.messages} />
}
