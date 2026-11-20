import "server-only"

export const GITHUB_SCOPE = "repo"

export class GithubConfigError extends Error {}

export function connectConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new GithubConfigError("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set.")
  if (!process.env.CLOUDHIKE_ENCRYPTION_KEY) throw new GithubConfigError("CLOUDHIKE_ENCRYPTION_KEY must be set.")
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim() || `${base}/api/github/callback`
  if (!/^https?:\/\//.test(redirectUri)) throw new GithubConfigError("Set GITHUB_REDIRECT_URI or NEXT_PUBLIC_APP_URL.")
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
