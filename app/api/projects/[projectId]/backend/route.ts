import { eq, sql } from "drizzle-orm"

import { appBackends, db, projects } from "@/db"
import { activeRun } from "@/lib/agent/run-store"
import { getBackend } from "@/lib/cloudhike/app-backend"
import { isConnectConfigured } from "@/lib/cloudhike/config"
import { forgetConnection, hasConnection } from "@/lib/cloudhike/connect"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { backendInfo } from "@/lib/cloudhike/provision"
import { isSameOriginJson, json, readJson } from "@/lib/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The app's backend and whether the creator's CloudHike account is connected. Never returns credentials. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error
  const [row, accountConnected] = await Promise.all([getBackend(projectId), hasConnection(owned.user.id)])
  return json({ configured: isConnectConfigured(), accountConnected, backend: backendInfo(row) })
}

/**
 * Disconnects the app from CloudHike: the app goes back to on-device data.
 * The CloudHike project and its data are kept (delete them in CloudHike).
 * With { forgetAccount: true } the stored CloudHike authorization is removed too.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error
  if (await activeRun(projectId)) return json({ error: "The agent is working on this app. Try again when it's done." }, 409)
  const body = await readJson(req)

  await db.delete(appBackends).where(eq(appBackends.projectId, projectId))
  await db
    .update(projects)
    .set({
      previewScreens: sql`jsonb_set(coalesce(${projects.previewScreens}, '{"v":2,"screens":[]}'::jsonb), '{backend}', '{"provider":"local"}'::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
  if (body?.forgetAccount === true) await forgetConnection(owned.user.id)
  return json({ ok: true })
}
