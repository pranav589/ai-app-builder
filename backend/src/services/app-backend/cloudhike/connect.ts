import { eq, sql } from "drizzle-orm"

import { cloudhikeConnections, db } from "@/db"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box"
import { ConnectError } from "../types"
import { CLOUDHIKE_ORIGIN, connectConfig, trustedCloudHikeUrl } from "./config"

// CloudHike Connect: authorize URL, code exchange, and the stored token.
// The signed state that pins a flow to one user and app is ../connect-state.ts.
// There is no refresh token: when CloudHike answers 401 the person has
// disconnected the app (or the token was replaced), and they connect again.

/** Where Connect starts; CloudHike sends the browser back to our callback with `state` and a one-time code. */
export function authorizeUrl(state: string) {
  const { clientId, redirectUri } = connectConfig()
  const url = new URL("/connect", CLOUDHIKE_ORIGIN)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  return url.toString()
}

/** Exchanges the one-time code (valid 5 minutes) for the user's access token and stores it encrypted. */
export async function completeConnect(userId: string, code: string) {
  const { clientId, clientSecret, redirectUri } = connectConfig()
  let res: Response
  try {
    res = await fetch(`${CLOUDHIKE_ORIGIN}/api/connect/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ConnectError("Couldn't reach CloudHike.", "unreachable")
  }
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    mcp_url?: string
    api_url?: string
    error?: string
  }
  if (!res.ok || !data.access_token) {
    // invalid_client means our developer app credentials are wrong: a setup problem, not the user's.
    throw new ConnectError(`CloudHike token exchange failed: ${res.status} ${data.error ?? ""}`, data.error ?? `http_${res.status}`)
  }
  const values = {
    accessTokenEnc: encryptSecret(data.access_token),
    mcpUrl: trustedCloudHikeUrl(data.mcp_url, `${CLOUDHIKE_ORIGIN}/api/mcp`),
    apiUrl: trustedCloudHikeUrl(data.api_url, `${CLOUDHIKE_ORIGIN}/api/v1`),
    status: "active",
    updatedAt: new Date(),
  }
  await db
    .insert(cloudhikeConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: cloudhikeConnections.userId, set: values })
}

export type CloudHikeAccess = { token: string; mcpUrl: string; apiUrl: string }

/** The user's working CloudHike access, or null when they haven't connected (or disconnected). */
export async function getAccess(userId: string): Promise<CloudHikeAccess | null> {
  const [row] = await db.select().from(cloudhikeConnections).where(eq(cloudhikeConnections.userId, userId)).limit(1)
  if (!row || row.status !== "active") return null
  try {
    return { token: decryptSecret(row.accessTokenEnc), mcpUrl: row.mcpUrl, apiUrl: row.apiUrl }
  } catch {
    // Encrypted with a key we no longer have: connect again.
    return null
  }
}

export async function hasConnection(userId: string) {
  const [row] = await db
    .select({ status: cloudhikeConnections.status })
    .from(cloudhikeConnections)
    .where(eq(cloudhikeConnections.userId, userId))
    .limit(1)
  return row?.status === "active"
}

/** CloudHike answered 401: the person disconnected this app in their CloudHike settings. */
export async function markRevoked(userId: string) {
  await db
    .update(cloudhikeConnections)
    .set({ status: "revoked", updatedAt: sql`now()` })
    .where(eq(cloudhikeConnections.userId, userId))
}

/** Forgets the token here. (CloudHike has no revoke endpoint; the person removes the app under Connected apps.) */
export async function forgetConnection(userId: string) {
  await db.delete(cloudhikeConnections).where(eq(cloudhikeConnections.userId, userId))
}
