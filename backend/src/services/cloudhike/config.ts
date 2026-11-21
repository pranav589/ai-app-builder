
// CloudHike Connect (https://cloudhike.dev/docs/connect) lets a person
// authorize this builder to manage their CloudHike workspace. We register one
// developer app (Settings → API & apps → Developer apps) and keep its
// credentials here, on the server.

export const CLOUDHIKE_ORIGIN = "https://cloudhike.dev"

/** Services a generated app can get. The first three are what the app runtime needs. */
export const BACKEND_SERVICES = ["postgres", "auth", "storage", "email", "jobs"] as const
export type BackendService = (typeof BACKEND_SERVICES)[number]
export const REQUIRED_SERVICES: BackendService[] = ["postgres", "auth", "storage"]

export function parseServices(raw: unknown): BackendService[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []
  const picked = new Set<BackendService>(REQUIRED_SERVICES)
  for (const s of list) if ((BACKEND_SERVICES as readonly string[]).includes(String(s).trim())) picked.add(String(s).trim() as BackendService)
  return BACKEND_SERVICES.filter((s) => picked.has(s))
}

export class CloudHikeConfigError extends Error {}

export function connectConfig() {
  const clientId = process.env.CLOUDHIKE_CLIENT_ID?.trim()
  const clientSecret = process.env.CLOUDHIKE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new CloudHikeConfigError("CLOUDHIKE_CLIENT_ID and CLOUDHIKE_CLIENT_SECRET must be set.")
  if (!process.env.CLOUDHIKE_ENCRYPTION_KEY) throw new CloudHikeConfigError("CLOUDHIKE_ENCRYPTION_KEY must be set.")
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  // Must match one of the callback URLs registered for the developer app exactly.
  const redirectUri = process.env.CLOUDHIKE_REDIRECT_URI?.trim() || `${base}/api/cloudhike/callback`
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
