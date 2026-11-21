import { randomBytes } from "node:crypto"
import { and, eq, isNull, sql } from "drizzle-orm"

import { appBackends, db, projects, type AppBackendRow } from "@/db"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box"
import type { BackendInfo } from "@app/shared/agent/types"
import { DEFAULT_BACKEND_PROVIDER, isBackendProviderId, type BackendProviderId } from "@app/shared/app-backend/providers"
import type { BackendConfig } from "@app/shared/app-runtime/app-doc"
import { AppBackendError, type AppEnv } from "./contract"

// The app_backends row and the app doc's `backend` field: the provider-neutral
// record of which backend an app runs on. Provider adapters write through these.

export async function getBackend(projectId: string): Promise<AppBackendRow | null> {
  const [row] = await db.select().from(appBackends).where(eq(appBackends.projectId, projectId)).limit(1)
  return row ?? null
}

/** Upserts the row for `provider` and answers the fresh row. */
export async function saveBackend(projectId: string, provider: BackendProviderId, patch: Partial<typeof appBackends.$inferInsert>) {
  const values = { ...patch, provider, updatedAt: new Date() }
  await db
    .insert(appBackends)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: appBackends.projectId, set: values })
  return getBackend(projectId)
}

/** Points the stored app doc at a backend, which is what the preview and exports read. */
export async function setDocBackend(projectId: string, backend: BackendConfig) {
  await db
    .update(projects)
    .set({
      previewScreens: sql`jsonb_set(coalesce(${projects.previewScreens}, '{"v":2,"screens":[]}'::jsonb), '{backend}', ${JSON.stringify(backend)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}

export function readEnv(row: AppBackendRow): AppEnv {
  if (!row.envEnc) throw new AppBackendError("This app's backend isn't set up yet.", 409)
  return JSON.parse(decryptSecret(row.envEnc)) as AppEnv
}

export const sealEnv = (env: AppEnv) => encryptSecret(JSON.stringify(env))

/** The row as the workspace shows it, without credentials. */
export function backendInfo(row: AppBackendRow | null): BackendInfo | null {
  if (!row) return null
  return {
    provider: isBackendProviderId(row.provider) ? row.provider : DEFAULT_BACKEND_PROVIDER,
    status: row.status,
    projectId: row.externalProjectId,
    projectName: row.externalProjectName,
    services: row.services,
    error: row.error,
    connectedAt: row.connectedAt?.toISOString() ?? null,
  }
}

/** The key built apps use to reach this project's public data route, minted the first time one is built. */
export async function ensureAppKey(row: AppBackendRow): Promise<string> {
  if (row.appKey) return row.appKey
  const appKey = randomBytes(24).toString("base64url")
  // Only set it if nobody beat us to it, so two simultaneous builds agree on one key.
  await db.update(appBackends).set({ appKey }).where(and(eq(appBackends.projectId, row.projectId), isNull(appBackends.appKey)))
  const fresh = await getBackend(row.projectId)
  return fresh?.appKey ?? appKey
}
