import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { applyCanvasEdit } from "@/lib/agent/orchestrator"
import { activeRun, finishRun, holdRun, openRun } from "@/lib/agent/run-store"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"
import { EDITABLE_STYLE_KEYS } from "@/lib/verify/codemod"
import type { ElementEdit } from "@/lib/preview/protocol"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const styleOf = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string" && val.length <= 200 && EDITABLE_STYLE_KEYS.has(k)) out[k] = val
  return Object.keys(out).length ? out : undefined
}

/**
 * Applies a canvas inspector edit (tap an element, change its text or a
 * style, Phase 8 item 3): no model call, just the AST codemod
 * (lib/verify/codemod.ts) and the usual gates before it's kept.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return json({ error: "We're having trouble reaching our servers." }, 503)
    throw e
  }
  if (!user) return json({ error: "Sign in to continue." }, 401)

  const { projectId } = await params
  const body = await readJson(req)
  const eid = str(body?.eid)
  if (!eid) return json({ error: "Bad request" }, 400)
  const text = typeof body?.text === "string" ? (body.text as string) : undefined
  const style = styleOf(body?.style)
  if (text === undefined && !style) return json({ error: "Bad request" }, 400)
  const from = typeof body?.from === "string" ? (body.from as string) : undefined
  const fromAlt = typeof body?.fromAlt === "string" ? (body.fromAlt as string) : undefined
  const edit: ElementEdit = { eid, text, from, fromAlt, style }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return json({ error: "Project not found." }, 404)

  // One agent job per project at a time; a build or edit in progress wins.
  let lock = await openRun(projectId, "canvas-edit")
  // A newer edit supersedes one still winding down (the browser aborted it):
  // wait briefly for that one to let go, instead of refusing.
  for (let i = 0; !lock && i < 40 && !req.signal.aborted; i++) {
    if ((await activeRun(projectId))?.kind !== "canvas-edit") break
    await new Promise((r) => setTimeout(r, 100))
    lock = await openRun(projectId, "canvas-edit")
  }
  if (!lock) return json({ error: "The agent is busy." }, 409)
  const release = holdRun(lock.id)
  let ok = false
  try {
    const result = await applyCanvasEdit(projectId, edit, req.signal)
    ok = true
    if ("error" in result) return json({ error: result.error, extraFiles: result.extraFiles }, 422)
    return json(result)
  } catch (e) {
    console.error("canvas edit failed", projectId, eid, e)
    return json({ error: "Couldn't apply that edit." }, 500)
  } finally {
    release()
    await finishRun(lock.id, ok ? "succeeded" : "failed").catch((e) => console.error("releasing canvas-edit lock failed", e))
  }
}
