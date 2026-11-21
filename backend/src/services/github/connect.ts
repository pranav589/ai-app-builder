import { randomBytes } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import { db, githubConnections } from "@/db"
import { decryptSecret, encryptSecret, safeEqual, sign, verifySigned } from "@/lib/crypto/secret-box"
import { connectConfig, GITHUB_SCOPE } from "./config"

export const STATE_COOKIE = "gh_connect"
const STATE_TTL_MS = 10 * 60 * 1000

type StatePayload = { n: string; u: string; p: string; e: number }

export function beginConnect(userId: string, projectId: string) {
  const { clientId, redirectUri } = connectConfig()
  const nonce = randomBytes(24).toString("base64url")
  const payload: StatePayload = { n: nonce, u: userId, p: projectId, e: Date.now() + STATE_TTL_MS }
  const cookie = sign(Buffer.from(JSON.stringify(payload)).toString("base64url"))
  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", GITHUB_SCOPE)
  url.searchParams.set("state", nonce)
  return { url: url.toString(), cookie, maxAge: STATE_TTL_MS / 1000 }
}

export function readConnectState(cookie: string | undefined, state: string | null, userId: string): StatePayload | null {
  if (!cookie || !state) return null
  const raw = verifySigned(cookie)
  if (!raw) return null
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as StatePayload
    if (p.e < Date.now() || p.u !== userId || !safeEqual(p.n, state)) return null
    return p
  } catch {
    return null
  }
}

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

export async function completeConnect(userId: string, code: string) {
  const { clientId, clientSecret, redirectUri } = connectConfig()
  let res: Response
  try {
    res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ConnectError("Couldn't reach GitHub.", "unreachable")
  }

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: string
    error_description?: string
    scope?: string
  }

  if (!res.ok || data.error || !data.access_token) {
    throw new ConnectError(
      data.error_description || data.error || `GitHub token exchange failed: ${res.status}`,
      data.error || `http_${res.status}`
    )
  }

  let userRes: Response
  try {
    userRes = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${data.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "Anything-App-Builder",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ConnectError("Couldn't fetch GitHub user profile.", "user_fetch_failed")
  }

  const userData = (await userRes.json().catch(() => ({}))) as { login?: string; id?: number }
  if (!userRes.ok || !userData.login || typeof userData.id !== "number") {
    throw new ConnectError("Invalid GitHub user response.", "invalid_user")
  }

  const values = {
    accessTokenEnc: encryptSecret(data.access_token),
    githubLogin: userData.login,
    githubUserId: userData.id,
    scope: data.scope || GITHUB_SCOPE,
    status: "active",
    updatedAt: new Date(),
  }

  await db
    .insert(githubConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: githubConnections.userId, set: values })
}

export type GithubAccess = { token: string; login: string; userId: number; scope: string }

export async function getAccess(userId: string): Promise<GithubAccess | null> {
  const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1)
  if (!row || row.status !== "active") return null
  try {
    return { token: decryptSecret(row.accessTokenEnc), login: row.githubLogin, userId: row.githubUserId, scope: row.scope }
  } catch {
    return null
  }
}

export async function hasConnection(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: githubConnections.status })
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId))
    .limit(1)
  return row?.status === "active"
}

export async function getConnection(userId: string): Promise<{ login: string; status: string } | null> {
  const [row] = await db
    .select({ status: githubConnections.status, login: githubConnections.githubLogin })
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId))
    .limit(1)
  if (!row || row.status !== "active") return null
  return { login: row.login, status: row.status }
}

export async function markRevoked(userId: string) {
  await db
    .update(githubConnections)
    .set({ status: "revoked", updatedAt: sql`now()` })
    .where(eq(githubConnections.userId, userId))
}

export async function forgetConnection(userId: string) {
  await db.delete(githubConnections).where(eq(githubConnections.userId, userId))
}
