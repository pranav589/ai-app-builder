// Pure decision logic for lib/agent/orchestrator.ts's screen build loop, kept
// separate so it can be unit tested without the rest of the agent's imports.

import type { GeneratedScreen } from "@app/shared/agent/types"
import { isAppOwned } from "@app/shared/verify/ownership"

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

/**
 * The new files a verified screen change wrote besides the screen itself: a
 * long screen split into components/<screen-id>/<Part>.tsx, a lib/ helper.
 * They passed the gates together with the screen, which imports them, so
 * they're kept with it. Edits to files that already existed are not: screens
 * build in parallel, and a shared file isn't one screen's to change.
 */
export function screenSideFiles(screenPath: string, before: Record<string, string>, after: Record<string, string>, changed: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of changed) if (p !== screenPath && !p.startsWith("app/") && isAppOwned(p) && !(p in before) && after[p] !== undefined) out[p] = after[p]
  return out
}

/** The stored project's side files (see screenSideFiles, and helpers later edits added): not screens, not shell files. Screens that survive a rebuild still import them. */
export function storedSideFiles(files: Record<string, string>, isShellFile: (path: string) => boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith("app/") && isAppOwned(p) && !isShellFile(p)))
}
