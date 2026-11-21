"use client"

import type { BackendConfig } from "@app/shared/app-runtime/app-doc"
import { LocalBackend } from "./local-backend"
import { ServerBackend } from "./server-backend"
import type { AppBackend } from "./types"

export * from "./types"

/**
 * Picks the backend for a generated app: the connected provider (through our
 * server) once the creator has connected one, otherwise on-device storage.
 */
export function createBackend(appId: string, config: BackendConfig): AppBackend {
  if (config.provider === "local") return new LocalBackend(appId)
  return new ServerBackend(appId, config.provider)
}
