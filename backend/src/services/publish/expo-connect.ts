import { eq, sql } from "drizzle-orm"
import { db, expoConnections } from "@/db"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box"

export class ExpoConnectError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

export async function validateExpoToken(token: string): Promise<{ username: string | null }> {
  let res: Response
  try {
    res = await fetch("https://api.expo.dev/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: "query { meUserActor { id username } }",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ExpoConnectError("Couldn't reach Expo API.", "unreachable")
  }

  const json = (await res.json().catch(() => ({}))) as {
    data?: { meUserActor?: { id?: string; username?: string } | null }
    errors?: Array<{ message?: string; code?: string }>
  }

  if (!res.ok || json.errors?.length || !json.data?.meUserActor) {
    const errMsg = json.errors?.[0]?.message || `Expo token validation failed: ${res.status}`
    throw new ExpoConnectError(errMsg, "invalid_token")
  }

  return {
    username: json.data.meUserActor.username || null,
  }
}

export async function saveToken(userId: string, token: string): Promise<{ username: string | null }> {
  const cleanToken = token.trim()
  if (!cleanToken) {
    throw new ExpoConnectError("Expo token is required.", "missing_token")
  }

  const { username } = await validateExpoToken(cleanToken)

  const values = {
    accessTokenEnc: encryptSecret(cleanToken),
    expoUsername: username,
    status: "active",
    updatedAt: new Date(),
  }

  await db
    .insert(expoConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: expoConnections.userId, set: values })

  return { username }
}

export type ExpoAccess = { token: string; expoUsername: string | null }

export async function getAccess(userId: string): Promise<ExpoAccess | null> {
  const [row] = await db.select().from(expoConnections).where(eq(expoConnections.userId, userId)).limit(1)
  if (!row || row.status !== "active") return null
  try {
    return { token: decryptSecret(row.accessTokenEnc), expoUsername: row.expoUsername }
  } catch {
    return null
  }
}

export async function getConnection(userId: string): Promise<{ expoUsername: string | null; status: string } | null> {
  const [row] = await db
    .select({ status: expoConnections.status, expoUsername: expoConnections.expoUsername })
    .from(expoConnections)
    .where(eq(expoConnections.userId, userId))
    .limit(1)
  if (!row || row.status !== "active") return null
  return { expoUsername: row.expoUsername, status: row.status }
}

export async function markRevoked(userId: string) {
  await db
    .update(expoConnections)
    .set({ status: "revoked", updatedAt: sql`now()` })
    .where(eq(expoConnections.userId, userId))
}

export async function forgetConnection(userId: string) {
  await db.delete(expoConnections).where(eq(expoConnections.userId, userId))
}
