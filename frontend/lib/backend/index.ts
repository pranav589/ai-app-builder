"use client"

import type { BackendConfig } from "@app/shared/app-runtime/app-doc"
import { CloudHikeBackend } from "./cloudhike-backend"
import { LocalBackend } from "./local-backend"
import type { AppBackend } from "./types"

export * from "./types"

/**
 * Picks the backend for a generated app: CloudHike once the creator has
 * connected it (Connect Backend in the workspace), otherwise on-device storage.
 */
export function createBackend(appId: string, config: BackendConfig): AppBackend {
  if (config.provider === "cloudhike") {
    return new CloudHikeBackend(appId, { projectRef: config.projectRef, region: config.region })
  }
  return new LocalBackend(appId)
}
