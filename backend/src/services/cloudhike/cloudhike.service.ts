import { eq, sql } from "drizzle-orm"
import { appBackends, db, projects } from "@/db"
import { activeRun } from "../agent/run-store"
import { getBackend, readEnv } from "./app-backend"
import { isConnectConfigured, parseServices } from "./config"
import {
  beginConnect,
  completeConnect,
  forgetConnection,
  hasConnection,
  readConnectState,
  STATE_COOKIE,
} from "./connect"
import { backendInfo } from "./provision"
import { AppBackendError, readFile, syncSchema } from "./app-data"
import { appOpFailure, runAppOp } from "./app-ops"
import { overLimit } from "./rate-limit"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { timingSafeEqual } from "node:crypto"

const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function getBackendStatus(userId: string, projectId: string) {
  const [row, accountConnected] = await Promise.all([getBackend(projectId), hasConnection(userId)])
  return { configured: isConnectConfigured(), accountConnected, backend: backendInfo(row) }
}

export async function disconnectBackend(userId: string, projectId: string, forgetAccount?: boolean) {
  if (await activeRun(projectId)) {
    throw Object.assign(new Error("The agent is working on this app. Try again when it's done."), { status: 409 })
  }

  await db.delete(appBackends).where(eq(appBackends.projectId, projectId))
  await db
    .update(projects)
    .set({
      previewScreens: sql`jsonb_set(coalesce(${projects.previewScreens}, '{"v":2,"screens":[]}'::jsonb), '{backend}', '{"provider":"local"}'::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))

  if (forgetAccount) {
    await forgetConnection(userId)
  }
}

export async function handlePreviewDataOp(
  userId: string,
  projectId: string,
  body: unknown,
  sessionHeader: string,
  appUrl: string
) {
  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) {
    throw Object.assign(new Error("This app isn't connected to CloudHike."), { status: 409 })
  }

  const [project] = await db
    .select({ previewScreens: projects.previewScreens })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const op = typeof (body as any)?.op === "string" ? (body as any).op : ""

  try {
    const env = readEnv(row)
    const model = readAppDoc(project?.previewScreens).data

    if (op === "init") {
      if (model && model.hash !== row.schemaHash) {
        await syncSchema(env, model)
      }
      return { result: null }
    }

    const result = await runAppOp(
      {
        projectId,
        env,
        model,
        session: sessionHeader,
        fileUrl: (key) => `${appUrl}/api/app-files/${encodeURIComponent(projectId)}/${key}`,
        resetRedirect: `${appUrl}/`,
        declaredOnly: false,
      },
      body && typeof body === "object" ? (body as Record<string, unknown>) : null
    )

    return { result }
  } catch (e) {
    const failure = appOpFailure(e, `${projectId} ${op}`)
    throw Object.assign(new Error(failure.error), { status: failure.status })
  }
}

export async function handleRuntimeDataOp(
  projectId: string,
  ip: string,
  appKey: string,
  sessionHeader: string,
  body: unknown,
  appUrl: string
) {
  if (overLimit(`${projectId}:${ip}`, 240, 60_000)) {
    throw Object.assign(new Error("Too many requests. Try again in a moment."), { status: 429 })
  }

  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc || !row.appKey || !sameKey(appKey, row.appKey)) {
    throw Object.assign(new Error("This app isn't connected to a backend."), { status: 403 })
  }

  const op = typeof (body as any)?.op === "string" ? (body as any).op : ""

  try {
    const [project] = await db
      .select({ previewScreens: projects.previewScreens })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    const env = readEnv(row)
    const model = readAppDoc(project?.previewScreens).data
    const result = await runAppOp(
      {
        projectId,
        env,
        model,
        session: sessionHeader,
        fileUrl: (key) => `${appUrl}/api/app-files/${encodeURIComponent(projectId)}/${key}`,
        resetRedirect: `${appUrl}/`,
        declaredOnly: true,
      },
      body && typeof body === "object" ? (body as Record<string, unknown>) : null
    )

    return { result }
  } catch (e) {
    const failure = appOpFailure(e, `${projectId} ${op}`)
    throw Object.assign(new Error(failure.error), { status: failure.status })
  }
}

export async function handleServeAppFile(projectId: string, fileKey: string) {
  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) {
    throw Object.assign(new Error("Not found"), { status: 404 })
  }

  return await readFile(readEnv(row), fileKey)
}

