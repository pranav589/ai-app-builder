// Pure decision logic for lib/agent/orchestrator.ts's screen build loop, kept
// separate so it can be unit tested without the rest of the agent's imports.

import type { GeneratedScreen } from "./types"

export type RegenOutcome = {
  patch: Partial<GeneratedScreen>
  /** The regeneration failed, but a previous ready version was kept instead of erroring. */
  kept: boolean
  /** The regeneration failed and there was nothing to fall back to. */
  failed: boolean
}

/**
 * Decides what a screen's build slot ends with. A screen that was ready
 * before this run and fails to regenerate keeps its previous code and state
 * rather than becoming an error, so one bad attempt never breaks a working screen.
 */
export function regenOutcome(prev: GeneratedScreen | undefined, path: string, code: string, error: string | undefined): RegenOutcome {
  if (code) return { patch: { state: "ready", code, path, error: undefined }, kept: false, failed: false }
  if (prev?.state === "ready" && prev.code) {
    return { patch: { state: "ready", code: prev.code, path: prev.path ?? path, error: undefined }, kept: true, failed: false }
  }
  return { patch: { state: "error", error }, kept: false, failed: true }
}
