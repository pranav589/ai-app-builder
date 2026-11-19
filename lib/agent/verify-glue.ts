import "server-only"

import { KIT_PATH, KIT_SOURCE } from "@/lib/app-project/kit"
import type { GateName, Workspace } from "@/lib/verify/types"
import type { LiveRun } from "./registry"

/**
 * Unlike theme/backend (parameterized by appSlug/data, rebuilt by
 * runGeneration), kit/index.tsx is a pure constant with nothing per-project
 * about it. A project built before a kit fix lands keeps the stale copy in
 * its stored files otherwise, since edit paths read doc.files as persisted
 * and don't go through a full build; resync it to the current KIT_SOURCE on
 * every edit so a kit fix reaches every project immediately.
 */
export function withCurrentKit(ws: Workspace): Workspace {
  return ws.files[KIT_PATH] === KIT_SOURCE ? ws : { ...ws, files: { ...ws.files, [KIT_PATH]: KIT_SOURCE } }
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
