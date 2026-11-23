
import { ensureAppKey, getBackend } from "@/lib/app-backend/app-backend"
import { lanIPv4Stable } from "@/lib/device/lan"
import { providerFor } from "@/lib/app-backend/registry"
import type { FileMap } from "@app/shared/verify/types"
import type { BackendProvider } from "@/lib/app-backend/types"
import { remoteBackendFiles, withRemoteBackendDeps } from "./backend-remote"
import { API_CONFIG_PATH } from "./api-client"

// Only for apps generated before the backend-conversion redesign
// (agent/backend-conversion.ts): their stored lib/backend is the on-device
// one, and this swaps it for the one that talks to the backend, at output
// time rather than in the stored files, so the app key never has to be
// baked into them where a disconnect couldn't take it back. A project that's
// gone through backend-conversion already has lib/api.ts/lib/api-config.ts
// committed straight into its stored files (the connected screens call them
// directly), so there's nothing left for this to swap.

/** `provider` is the connected backend's, or null when the app keeps its on-device data. */
export type WithBackend = { files: FileMap; provider: BackendProvider | null }

/**
 * The builder's public address, which built apps call. When that's localhost
 * (local development), every output (QR preview, ZIP, APK) would be unusable on
 * a phone, where "localhost" is the phone itself, so this machine's LAN address
 * is used instead: the app then works on the same Wi-Fi while the builder runs.
 * Done here, not by each caller, so no output path can forget it.
 */
export async function builderUrl(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
  if (!configured) throw new Error("Set NEXT_PUBLIC_APP_URL so built apps know where to reach the backend.")
  const url = new URL(configured)
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return configured
  const lan = await lanIPv4Stable()
  if (!lan) {
    console.warn(`NEXT_PUBLIC_APP_URL is ${configured} and this machine has no LAN address: a built app on a phone won't reach the backend.`)
    return configured
  }
  url.hostname = lan
  return url.origin
}

export async function withBackend(projectId: string, files: FileMap): Promise<WithBackend> {
  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) return { files, provider: null }
  if (files[API_CONFIG_PATH]) return { files, provider: providerFor(row) }
  const appKey = await ensureAppKey(row)
  const endpoint = `${await builderUrl()}/api/app-runtime/${encodeURIComponent(projectId)}/data`
  const swapped: FileMap = { ...files, ...remoteBackendFiles(projectId, endpoint, appKey) }
  if (swapped["package.json"]) swapped["package.json"] = withRemoteBackendDeps(swapped["package.json"])
  return { files: swapped, provider: providerFor(row) }
}
