import { randomBytes } from "node:crypto"
import { desc, eq, sql } from "drizzle-orm"

import { db, messages, projects, type Project } from "@/db"
import { type AppDoc } from "@app/shared/app-runtime/app-doc"
import type { ElementRef } from "@app/shared/preview/protocol"
import { parseElementRef } from "@app/shared/agent/element-context"
import { normalizePlan } from "./protocol"
import type {
  AgentPhase,
  AppPlan,
  BuildProgress,
  ChatMessageKind,
  GeneratedScreen,
  StoredMessage,
} from "@app/shared/agent/types"

const id = (p: string) => `${p}-${Date.now()}-${randomBytes(3).toString("hex")}`

type DbMessage = typeof messages.$inferSelect

export function toStoredMessage(m: DbMessage): StoredMessage {
  const kind = (["plan", "build"].includes(m.type ?? "") ? m.type : "standard") as ChatMessageKind
  return {
    id: m.id,
    sender: m.sender === "user" ? "user" : "assistant",
    kind,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
    plan: kind === "plan" ? ((m.plan as AppPlan | null) ?? undefined) : undefined,
    build: kind === "build" ? ((m.pipelineData as BuildProgress | null) ?? undefined) : undefined,
    version: (m.pipelineData as { version?: number } | null)?.version,
    element: m.sender === "user" ? parseElementRef((m.pipelineData as { element?: unknown } | null)?.element) : undefined,
  }
}

export async function saveMessage(
  projectId: string,
  m: {
    id?: string
    sender: "user" | "assistant"
    kind: ChatMessageKind
    text: string
    plan?: AppPlan
    build?: BuildProgress
    meta?: Record<string, unknown>
    /** The version this message committed, shown as a small label in the chat. */
    version?: number
  }
) {
  const pipelineData =
    m.kind === "build"
      ? m.build ?? null
      : m.meta || m.version !== undefined
        ? { ...(m.meta ?? {}), ...(m.version !== undefined ? { version: m.version } : {}) }
        : null
  const [row] = await db
    .insert(messages)
    .values({
      id: m.id ?? id("msg"),
      projectId,
      sender: m.sender,
      text: m.text,
      type: m.kind,
      plan: m.plan ?? null,
      pipelineData,
    })
    .returning()
  return toStoredMessage(row)
}

export async function saveUserMessage(projectId: string, text: string, screenId?: string, element?: ElementRef) {
  const meta = screenId || element ? { ...(screenId ? { screenId } : {}), ...(element ? { element } : {}) } : undefined
  return saveMessage(projectId, { sender: "user", kind: "standard", text, meta })
}

export async function setPhase(projectId: string, phase: AgentPhase, extra: Partial<Project> = {}) {
  await db
    .update(projects)
    .set({ status: phase, updatedAt: new Date(), ...extra })
    .where(eq(projects.id, projectId))
}

/**
 * The most recent valid plan. Validated through `normalizePlan`, not just
 * cast: a handful of very old projects have a `plan` column from before the
 * current AppPlan shape existed (different field names entirely, no
 * `appName`), and treating that raw JSON as today's AppPlan crashes
 * everything downstream that reads `plan.appName`/`plan.screens[].name`
 * (manifest migration among them). Those projects are reported as having no
 * usable plan, same as one that was never saved, rather than crashing.
 */
export async function latestPlan(projectId: string): Promise<AppPlan | null> {
  const rows = await db
    .select({ plan: messages.plan })
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(desc(messages.createdAt))
    .limit(60)
    .then((rows) => rows.filter((r) => r.plan))
  for (const row of rows) {
    const plan = normalizePlan(row.plan)
    if (plan) return plan
  }
  return null
}

export async function loadProject(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw new Error("project not found")
  return project
}

/** Writes the whole app document (screens, themes, data model). */
export async function saveDoc(projectId: string, doc: AppDoc, extra: Partial<Project> = {}) {
  await db
    .update(projects)
    .set({ previewScreens: doc, updatedAt: new Date(), ...extra })
    .where(eq(projects.id, projectId))
}

/**
 * Writes only the screens, leaving the rest of the document alone, so a
 * theme the creator picks while screens are still building isn't lost.
 */
export async function saveScreens(projectId: string, screens: GeneratedScreen[]) {
  await db
    .update(projects)
    .set({
      previewScreens: sql`jsonb_set(coalesce(${projects.previewScreens}, '{}'::jsonb), '{screens}', ${JSON.stringify(screens)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}
