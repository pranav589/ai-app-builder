import { randomBytes } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"

import { appBackends, db, type AppBackendRow } from "@/db"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box"
import { AppBackendError, type AppEnv } from "./app-data"

export async function getBackend(projectId: string): Promise<AppBackendRow | null> {
  const [row] = await db.select().from(appBackends).where(eq(appBackends.projectId, projectId)).limit(1)
  return row ?? null
}

export function readEnv(row: AppBackendRow): AppEnv {
  if (!row.envEnc) throw new AppBackendError("This app's backend isn't set up yet.", 409)
  return JSON.parse(decryptSecret(row.envEnc)) as AppEnv
}

export const sealEnv = (env: AppEnv) => encryptSecret(JSON.stringify(env))

/** The key built apps use to reach this project's public data route, minted the first time one is built. */
export async function ensureAppKey(row: AppBackendRow): Promise<string> {
  if (row.appKey) return row.appKey
  const appKey = randomBytes(24).toString("base64url")
  // Only set it if nobody beat us to it, so two simultaneous builds agree on one key.
  await db.update(appBackends).set({ appKey }).where(and(eq(appBackends.projectId, row.projectId), isNull(appBackends.appKey)))
  const fresh = await getBackend(row.projectId)
  return fresh?.appKey ?? appKey
}
