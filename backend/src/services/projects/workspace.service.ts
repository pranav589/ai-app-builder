import { and, asc, eq } from "drizzle-orm"
import { db, messages, projects } from "@/db"
import { signedDownloadUrl } from "../storage"
import { toStoredMessage } from "../agent/orchestrator"
import type { AgentPhase } from "@app/shared/agent/types"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { backendInfo, getBackend } from "../app-backend/app-backend"
import { providerStatuses } from "../app-backend/backend.service"
import { withBackend } from "../app-project/with-backend"

const PHASES: AgentPhase[] = ["draft", "planning", "awaiting_approval", "generating", "ready"]
const normalizePhase = (s: string | null): AgentPhase => (PHASES.includes(s as AgentPhase) ? (s as AgentPhase) : "draft")

export async function getWorkspaceData(userId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) return null

  const [assets, history, backendRow, backendProviders] = await Promise.all([
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
    providerStatuses(userId),
  ])

  const doc = readAppDoc(project.previewScreens)
  // The stored lib/backend is always the on-device one (with-backend.ts never
  // persists the connected version, so a disconnect can revoke the key
  // without resyncing every project). The code tab reads live, though, not
  // an export, so without this it would show Zustand/local even once a
  // backend is actually connected and the app is really calling it over
  // Axios + React Query -- exactly the mismatch that prompted this.
  const { files } = await withBackend(project.id, doc.files ?? {})
  const data = {
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
    files,
    backend: doc.backend,
    backendInfo: backendInfo(backendRow),
    backendProviders,
    isPublic: project.isPublic,
    publicSlug: project.publicSlug,
  }

  const firstUser = history.findIndex((m) => m.sender === "user")
  const chat = history.map((m, i) => ({
    ...toStoredMessage(m),
    assets: i === firstUser ? assets : undefined,
  }))

  return { project: data, messages: chat }
}
