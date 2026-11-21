import "server-only"

import { ensureAppKey, getBackend } from "@/lib/cloudhike/app-backend"
import { lanIPv4Stable } from "@/lib/device/lan"
import type { FileMap } from "@/lib/verify/types"
import { remoteBackendFiles } from "./backend-remote"

// Every output of a project (APK, Expo Go preview, web deploy, ZIP, GitHub)
// starts from the stored files, whose lib/backend is the on-device one. When
// the creator has connected CloudHike, this swaps it for the one that talks to
// the backend, at output time rather than in the stored files: the stored
// files are regenerated on every plan change, and the app key must never be
// baked into them where a disconnect couldn't take it back.

export type WithBackend = { files: FileMap; connected: boolean }

/**
 * The builder's public address, which built apps call. When that's localhost
 * (local development), every output (QR preview, ZIP, APK) would be unusable on
 * a phone, where "localhost" is the phone itself, so this machine's LAN address
 * is used instead: the app then works on the same Wi-Fi while the builder runs.
 * Done here, not by each caller, so no output path can forget it.
 */
async function builderUrl(): Promise<string> {
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
  if (!row || row.status !== "ready" || !row.envEnc) return { files, connected: false }
  const appKey = await ensureAppKey(row)
  const endpoint = `${await builderUrl()}/api/app-runtime/${encodeURIComponent(projectId)}/data`
  return { files: { ...files, ...remoteBackendFiles(projectId, endpoint, appKey) }, connected: true }
}
