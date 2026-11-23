import { hasSecretKey } from "@/lib/crypto/secret-box"

// CloudHike Connect (https://cloudhike.dev/docs/connect) lets a person
// authorize this builder to manage their CloudHike workspace. We register one
// developer app (Settings → API & apps → Developer apps) and keep its
// credentials here, on the server.

export const CLOUDHIKE_ORIGIN = "https://cloudhike.dev"

export class CloudHikeConfigError extends Error {}

export function connectConfig() {
  const clientId = process.env.CLOUDHIKE_CLIENT_ID?.trim()
  const clientSecret = process.env.CLOUDHIKE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new CloudHikeConfigError("CLOUDHIKE_CLIENT_ID and CLOUDHIKE_CLIENT_SECRET must be set.")
  if (!hasSecretKey()) throw new CloudHikeConfigError("SECRETS_ENCRYPTION_KEY must be set.")
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  // Must match one of the callback URLs registered for the developer app exactly.
  const redirectUri = process.env.CLOUDHIKE_REDIRECT_URI?.trim() || `${base}/api/backend-providers/cloudhike/callback`
  if (!/^https?:\/\//.test(redirectUri)) throw new CloudHikeConfigError("Set CLOUDHIKE_REDIRECT_URI or NEXT_PUBLIC_APP_URL.")
  return { clientId, clientSecret, redirectUri }
}

export function isConnectConfigured() {
  try {
    connectConfig()
    return true
  } catch {
    return false
  }
}

/**
 * The token response names the API and MCP URLs. They must stay on
 * CloudHike's own origin: the user's access token is sent to them.
 */
export function trustedCloudHikeUrl(raw: unknown, fallback: string) {
  try {
    const u = new URL(String(raw))
    if (u.protocol === "https:" && (u.hostname === "cloudhike.dev" || u.hostname.endsWith(".cloudhike.dev"))) return u.toString().replace(/\/+$/, "")
  } catch {}
  return fallback
}
