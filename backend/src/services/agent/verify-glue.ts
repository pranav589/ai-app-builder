import { platformKitUpdates } from "@/lib/app-project/platform-kits"
import { compileManifest } from "@app/shared/manifest/compile"
import type { AppManifest } from "@app/shared/manifest/schema"
import type { GateName, Workspace } from "@app/shared/verify/types"
import type { LiveRun } from "./registry"

/**
 * Brings a stored project's platform-written files up to date before it's
 * edited or exported: the kits (@/kit, @/motion; see platformKitUpdates) and
 * the manifest compiler's output (layouts, nav, data types), which otherwise
 * only regenerates when an edit patches the manifest. Neither is ever written
 * by the AI, so a fix to either reaches every project on its next edit or
 * device build.
 */
export function withCurrentPlatform(ws: Workspace): Workspace {
  const updates = platformKitUpdates(ws.files)
  const manifest = ws.manifest as AppManifest | undefined
  if (manifest) for (const [path, code] of Object.entries(compileManifest(manifest, { connected: ws.connected }))) if (ws.files[path] !== code) updates[path] = code
  return Object.keys(updates).length ? { ...ws, files: { ...ws.files, ...updates } } : ws
}

/** VERIFY_DEBUG_FAIL=<gate>:<n>, ignored in production: fails `gate` synthetically for a run's first `n` attempts. */
export function verifyDebugFail(): { gate: GateName; n: number } | undefined {
  if (process.env.NODE_ENV === "production") return undefined
  const raw = process.env.VERIFY_DEBUG_FAIL?.trim()
  if (!raw) return undefined
  const [gate, nStr] = raw.split(":")
  const n = Number(nStr)
  if (!gate || !Number.isFinite(n)) return undefined
  return { gate: gate as GateName, n }
}

/** Every verified model call + gate run, as an event the run's agent_events log already captures. */
export function emitAttempts(
  run: LiveRun,
  attempts: {
    n: number
    modelMs: number
    gatesMs: number
    ok: boolean
    failedAt?: GateName
    diagnostics?: string
    tokens?: { prompt?: number; completion?: number }
  }[]
) {
  for (const a of attempts) run.emit({ type: "attempt", ...a })
}
