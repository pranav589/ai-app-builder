import { timingSafeEqual } from "node:crypto"
import { eq } from "drizzle-orm"

import { appBackends, db, projects, type AppBackendRow } from "@/db"
import type { BackendProviderStatus } from "@app/shared/app-backend/providers"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { activeRun } from "../agent/run-store"
import { backendInfo, getBackend, readEnv, setDocBackend } from "./app-backend"
import { appOpFailure, runAppOp } from "./app-ops"
import { overLimit } from "./rate-limit"
import { listProviders, providerFor } from "./registry"

// What the routes do with an app's backend, whichever provider it's on: the
// row says which provider, and that provider's adapter does the work.

const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status })

/** Every provider's link state for this creator, for the Connect dialog. */
export async function providerStatuses(userId: string): Promise<BackendProviderStatus[]> {
  return Promise.all(
    listProviders().map(async (p) => ({ id: p.id, configured: p.connect.isConfigured(), accountConnected: await p.connect.hasConnection(userId).catch(() => false) }))
  )
}

export async function getBackendStatus(userId: string, projectId: string) {
  const [row, providers] = await Promise.all([getBackend(projectId), providerStatuses(userId)])
  return { providers, backend: backendInfo(row) }
}

export async function disconnectBackend(userId: string, projectId: string, forgetAccount?: boolean) {
  if (await activeRun(projectId)) throw httpError("The agent is working on this app. Try again when it's done.", 409)

  const row = await getBackend(projectId)
  await db.delete(appBackends).where(eq(appBackends.projectId, projectId))
  await setDocBackend(projectId, { provider: "local" })

  if (forgetAccount && row) await providerFor(row).connect.forget(userId)
}

async function currentModel(projectId: string) {
  const [project] = await db.select({ previewScreens: projects.previewScreens }).from(projects).where(eq(projects.id, projectId)).limit(1)
  return readAppDoc(project?.previewScreens).data
}

/** Runs one { op, ...args } call against the row's provider. */
async function runOp(row: AppBackendRow, projectId: string, body: unknown, session: string, appUrl: string, declaredOnly: boolean) {
  const op = typeof (body as { op?: unknown })?.op === "string" ? (body as { op: string }).op : ""
  try {
    const env = readEnv(row)
    const model = await currentModel(projectId)
    const provider = providerFor(row)

    // The builder's preview asks for this on load, so new collections exist before the first write.
    if (op === "init" && !declaredOnly) {
      if (model && model.hash !== row.schemaHash) await provider.syncSchema(env, model)
      return { result: null }
    }

    const services = provider.runtime({
      projectId,
      env,
      model,
      fileUrl: (key) => `${appUrl}/api/app-files/${encodeURIComponent(projectId)}/${key}`,
      resetRedirect: `${appUrl}/`,
    })
    const result = await runAppOp({ services, model, session, declaredOnly }, body && typeof body === "object" ? (body as Record<string, unknown>) : null)
    return { result }
  } catch (e) {
    const failure = appOpFailure(e, `${projectId} ${op}`)
    throw httpError(failure.error, failure.status)
  }
}

/** A call from the builder's own preview: the owner, any collection. */
export async function handlePreviewDataOp(projectId: string, body: unknown, sessionHeader: string, appUrl: string) {
  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) throw httpError("This app isn't connected to a backend.", 409)
  return runOp(row, projectId, body, sessionHeader, appUrl, false)
}

/** A call from a built app: needs the app key, and only reaches collections the data model declares. */
export async function handleRuntimeDataOp(projectId: string, ip: string, appKey: string, sessionHeader: string, body: unknown, appUrl: string) {
  if (overLimit(`${projectId}:${ip}`, 240, 60_000)) throw httpError("Too many requests. Try again in a moment.", 429)

  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc || !row.appKey || !sameKey(appKey, row.appKey)) {
    throw httpError("This app isn't connected to a backend.", 403)
  }
  return runOp(row, projectId, body, sessionHeader, appUrl, true)
}

export async function handleServeAppFile(projectId: string, fileKey: string) {
  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) throw httpError("Not found", 404)
  return providerFor(row).readFile(readEnv(row), fileKey)
}

/** After a build changed the data model: add the new tables to a connected app's database. Never fails the build. */
export async function syncBackendSchema(projectId: string) {
  try {
    const row = await getBackend(projectId)
    if (!row || row.status !== "ready" || !row.envEnc) return
    const data = await currentModel(projectId)
    if (!data || data.hash === row.schemaHash) return
    await providerFor(row).syncSchema(readEnv(row), data)
    await db.update(appBackends).set({ schemaHash: data.hash, updatedAt: new Date() }).where(eq(appBackends.projectId, projectId))
  } catch (e) {
    console.error("syncing the app's backend tables failed", projectId, e)
  }
}
