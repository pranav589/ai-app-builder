import { and, eq } from "drizzle-orm"
import { db, deviceBuilds, projects } from "@/db"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { DeviceDepsMissingError } from "./export"
import { deviceLaneStatus, MetroPortBusyError, startDeviceLane, stopDeviceLane } from "./lane"
import { cancelDeviceBuild, isDeviceBuildRunning, startDeviceBuild } from "./build"
import { lanIPv4 } from "./lan"
import { buildDeviceManifest, type DeviceManifestPlatform } from "./manifest"
import type { BuildPlatform } from "@app/shared/api-types"
import { workspaceFromDoc } from "../verify/workspace"
import { withCurrentPlatform } from "../agent/verify-glue"

export function publicDeviceHost(reqHost?: string, backendPort = 4000): string {
  if (process.env.NODE_ENV === "production") return reqHost || "localhost:4000"
  return `${lanIPv4() ?? "localhost"}:${backendPort}`
}

export async function getMetroLaneStatus(userId: string, projectId: string) {
  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("Not available."), { status: 404 })
  }
  const [project] = await db
    .select({ id: projects.id, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return null

  return deviceLaneStatus(projectId)
}

export async function startMetroLane(userId: string, projectId: string) {
  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("Not available."), { status: 404 })
  }
  const [project] = await db
    .select({ id: projects.id, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return null

  const workspace = withCurrentPlatform(workspaceFromDoc(readAppDoc(project.previewScreens)))
  try {
    return await startDeviceLane(projectId, workspace.files)
  } catch (e) {
    if (e instanceof DeviceDepsMissingError) {
      throw Object.assign(new Error("Device dependencies not ready."), { status: 503, reason: "deps_missing" })
    }
    if (e instanceof MetroPortBusyError) {
      throw Object.assign(new Error(e.message), { status: 409, reason: "port_busy" })
    }
    throw e
  }
}

export async function stopMetroLane(userId: string, projectId: string) {
  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("Not available."), { status: 404 })
  }
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return null

  await stopDeviceLane()
  return { ok: true }
}

export async function getDeviceBuildStatus(userId: string, projectId: string, reqHost?: string, backendPort = 4000) {
  const [project] = await db
    .select({ currentVersion: projects.currentVersion })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return null

  const [build] = await db.select().from(deviceBuilds).where(eq(deviceBuilds.projectId, projectId)).limit(1)
  if (!build) return { status: "none" as const }

  const host = publicDeviceHost(reqHost, backendPort)
  // A row left "building" by a server restart has no process to finish it.
  const orphaned = build.status === "building" && !isDeviceBuildRunning(projectId)
  return {
    platform: build.platform,
    status: orphaned ? ("failed" as const) : build.status,
    error: orphaned ? "The build was interrupted because the server restarted. Build again." : build.error,
    stale: build.status === "ready" && build.builtVersion !== project.currentVersion,
    manifestUrl: build.status === "ready" ? `exp://${host}/api/device/${projectId}/manifest` : null,
  }
}

export async function triggerDeviceBuild(userId: string, projectId: string, platform: BuildPlatform, reqHost?: string) {
  const [project] = await db
    .select({ id: projects.id, name: projects.name, currentVersion: projects.currentVersion, previewScreens: projects.previewScreens })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return null

  const workspace = withCurrentPlatform(workspaceFromDoc(readAppDoc(project.previewScreens)))
  try {
    await startDeviceBuild({
      projectId,
      userId,
      currentVersion: project.currentVersion,
      platform,
      files: workspace.files,
    })
    // The caller shows this as the build's state right away, so it must be the same shape GET returns.
    return await getDeviceBuildStatus(userId, projectId, reqHost)
  } catch (e) {
    if (e instanceof DeviceDepsMissingError) {
      throw Object.assign(new Error("Device dependencies not ready."), { status: 503, reason: "deps_missing" })
    }
    throw e
  }
}

export async function getPublicDeviceManifest(projectId: string, platform: DeviceManifestPlatform) {
  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return null

  const [build] = await db.select().from(deviceBuilds).where(eq(deviceBuilds.projectId, projectId)).limit(1)
  // A build only holds the platform it was made for; the phone's other one has nothing to serve.
  if (!build || build.status !== "ready" || !build.s3Prefix || build.platform !== platform) return null

  return await buildDeviceManifest({
    s3Prefix: build.s3Prefix,
    platform,
    projectId: project.id,
    projectName: project.name,
  })
}


export async function stopDeviceBuild(userId: string, projectId: string, reqHost?: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  if (!project) return null

  if (!(await cancelDeviceBuild(projectId))) {
    throw Object.assign(new Error("No build is running."), { status: 409, code: "not_running" })
  }
  return await getDeviceBuildStatus(userId, projectId, reqHost)
}
