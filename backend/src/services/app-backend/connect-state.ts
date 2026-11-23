import { randomBytes } from "node:crypto"

import { safeEqual, sign, verifySigned } from "@/lib/crypto/secret-box"
import type { BackendProviderId, BackendService } from "@app/shared/app-backend/providers"

// The signed cookie that pins a provider's account-link redirect to the user,
// app, provider and services it started with. The provider only ever sees
// the nonce (`state`); the callback checks it against this cookie.

export const STATE_COOKIE = "backend_connect"
const STATE_TTL_MS = 10 * 60 * 1000

export type ConnectState = { n: string; u: string; p: string; v: BackendProviderId; s: BackendService[]; e: number }

/** The nonce to hand the provider, and the cookie to set. */
export function beginConnectState(userId: string, projectId: string, provider: BackendProviderId, services: BackendService[]) {
  const nonce = randomBytes(24).toString("base64url")
  const payload: ConnectState = { n: nonce, u: userId, p: projectId, v: provider, s: services, e: Date.now() + STATE_TTL_MS }
  const cookie = sign(Buffer.from(JSON.stringify(payload)).toString("base64url"))
  return { nonce, cookie, maxAge: STATE_TTL_MS / 1000 }
}

/** The flow the callback belongs to, or null when the cookie is missing, expired, or for someone or something else. */
export function readConnectState(cookie: string | undefined, state: string | null, userId: string, provider: BackendProviderId): ConnectState | null {
  if (!cookie || !state) return null
  const raw = verifySigned(cookie)
  if (!raw) return null
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ConnectState
    if (p.e < Date.now() || p.u !== userId || p.v !== provider || !safeEqual(p.n, state)) return null
    return p
  } catch {
    return null
  }
}
