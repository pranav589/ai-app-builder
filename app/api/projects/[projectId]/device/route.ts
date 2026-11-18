import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { DeviceDepsMissingError } from "@/lib/device/export"
import { deviceLaneStatus, MetroPortBusyError, startDeviceLane, stopDeviceLane } from "@/lib/device/lane"
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user"
import { isSameOrigin, json } from "@/lib/http"
import { workspaceFromDoc } from "@/lib/verify/workspace"

export const runtime = "nodejs"

/**
 * Dev-only device lane for the "Test on your phone" dialog
 * (components/workspace/expo-qr.tsx):
 *   GET    status and exp:// URL (also sees a lane started with `npm run device`)
 *   POST   export the current files and start Metro (restarts if already running)
 *   DELETE stop it
 * Metro runs on this machine (lib/device/lane.ts), so only a phone on the same
 * Wi-Fi can reach it; there's nothing to run in a deployed environment, so all
 * of this is refused outside development.
 */
type Ctx = { params: Promise<{ projectId: string }> }

/** The caller's own project, or the error response to return instead. */
async function ownProject(ctx: Ctx) {
  if (process.env.NODE_ENV === "production") return { error: json({ error: "Not available." }, 404) }

  let user
  try {
    user = await getCurrentUser()
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return { error: json({ error: "We're having trouble reaching our servers." }, 503) }
    throw e
  }
  if (!user) return { error: json({ error: "Sign in to continue." }, 401) }

  const { projectId } = await ctx.params
  const [project] = await db
    .select({ id: projects.id, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1)
  if (!project) return { error: json({ error: "Project not found." }, 404) }
  return { project }
}

export async function GET(_req: Request, ctx: Ctx) {
  const r = await ownProject(ctx)
  if (r.error) return r.error
  return json(await deviceLaneStatus(r.project.id))
}

export async function POST(req: Request, ctx: Ctx) {
  if (!isSameOrigin(req)) return json({ error: "Forbidden." }, 403)
  const r = await ownProject(ctx)
  if (r.error) return r.error

  const files = workspaceFromDoc(readAppDoc(r.project.previewScreens)).files
  try {
    await startDeviceLane(r.project.id, files)
  } catch (e) {
    if (e instanceof DeviceDepsMissingError || e instanceof MetroPortBusyError) return json({ error: e.message }, 409)
    throw e
  }
  return json(await deviceLaneStatus(r.project.id))
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!isSameOrigin(req)) return json({ error: "Forbidden." }, 403)
  const r = await ownProject(ctx)
  if (r.error) return r.error

  // Only stop the lane if it's this project's; another tab may be using it.
  const status = await deviceLaneStatus(r.project.id)
  if (status.status === "starting" || status.status === "running") await stopDeviceLane()
  return json(await deviceLaneStatus(r.project.id))
}
