import { eq } from "drizzle-orm"

import { db, deviceBuilds, projects } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { startDeviceBuild } from "@/lib/device/build"
import { lanIPv4 } from "@/lib/device/lan"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { isSameOrigin, json } from "@/lib/http"
import { workspaceFromDoc } from "@/lib/verify/workspace"

export const runtime = "nodejs"

/**
 * "Build for phone" (components/workspace/expo-qr.tsx): runs `expo export` for the
 * project's current files and uploads it to S3 (lib/device/build.ts), so the public,
 * unauthenticated app/api/device/[projectId]/manifest route can serve Expo Go a
 * ready-made app with no Metro running. Separate from the dev-only Metro lane
 * (app/api/projects/[projectId]/device): that one needs the caller on the same
 * Wi-Fi as this server, this one doesn't.
 *   GET  current build status (+ whether it's stale vs. the project's latest edits)
 *   POST start a build (no-ops if one is already running)
 */
type Ctx = { params: Promise<{ projectId: string }> }

/** Dev has no public domain to hand out, so the phone needs this machine's LAN address instead -- same tradeoff as the Metro lane (lib/device/lane.ts), just for a different port. */
function publicHost(req: Request): string {
  const host = req.headers.get("host") ?? "localhost:3000"
  if (process.env.NODE_ENV === "production") return host
  const port = host.split(":")[1] ?? "3000"
  return `${lanIPv4() ?? "localhost"}:${port}`
}

async function statusFor(req: Request, projectId: string, currentVersion: number) {
  const [build] = await db.select().from(deviceBuilds).where(eq(deviceBuilds.projectId, projectId)).limit(1)
  if (!build) return { status: "none" as const }
  return {
    status: build.status,
    error: build.error,
    stale: build.status === "ready" && build.builtVersion !== currentVersion,
    manifestUrl: build.status === "ready" ? `exp://${publicHost(req)}/api/device/${projectId}/manifest` : null,
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { projectId } = await ctx.params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const [project] = await db.select({ currentVersion: projects.currentVersion }).from(projects).where(eq(projects.id, projectId)).limit(1)
  return json(await statusFor(req, projectId, project?.currentVersion ?? 0))
}

export async function POST(req: Request, ctx: Ctx) {
  if (!isSameOrigin(req)) return json({ error: "Forbidden." }, 403)
  const { projectId } = await ctx.params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const [project] = await db
    .select({ currentVersion: projects.currentVersion, previewScreens: projects.previewScreens })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) return json({ error: "Project not found." }, 404)

  const files = workspaceFromDoc(readAppDoc(project.previewScreens)).files
  await startDeviceBuild({ projectId, userId: owned.user.id, files, currentVersion: project.currentVersion })

  return json(await statusFor(req, projectId, project.currentVersion))
}
