// Fast tier: cheapest gate first, stop at the first failure.

import type { ChangeSet, GateName, GateResult, Workspace } from "@app/shared/verify/types"
import { applyChangeSet } from "./workspace"
import { parseGate } from "./gates/parse"
import { policyGate } from "./gates/policy"
import { typecheckGate } from "./gates/typecheck"
import { renderGate } from "./gates/render"

export type Verdict = {
  ok: boolean
  ws?: Workspace
  changed: string[]
  results: GateResult[]
  /** The first gate that failed, if any. */
  failedAt?: GateName
}

export type Gate = (ws: Workspace, changed?: string[], key?: string, base?: Workspace) => GateResult | Promise<GateResult>

const GATES: Gate[] = [parseGate, policyGate, typecheckGate, renderGate]

/**
 * `changed` scopes the gates to the files this attempt actually touched, so
 * a project with pre-existing files that predate these rules isn't blocked
 * by problems an edit elsewhere didn't create. Omit it to check everything
 * (a fresh build).
 *
 * `base` is the workspace before this attempt's changes, if any: the policy
 * gate's line-count check uses it to only block a file for getting *longer*,
 * not for having already been over the limit before the edit touched it
 * (every real project built before stricter decomposition guidance existed
 * has screens already over the limit).
 *
 * `key` identifies which project this is, so the tsc gate reuses its warm
 * LanguageService across repair rounds and repeat edits to the same project
 * instead of rebuilding it (and so an unrelated project's checks never
 * invalidate it). Omit it only for one-off checks (tests, a single eval task).
 */
export async function verifyWorkspace(ws: Workspace, changed?: string[], key?: string, base?: Workspace, extraGates: Gate[] = []): Promise<Verdict> {
  const results: GateResult[] = []
  for (const gate of [...GATES, ...extraGates]) {
    const r = await gate(ws, changed, key, base)
    results.push(r)
    if (!r.ok) return { ok: false, ws, changed: changed ?? [], results, failedAt: r.gate }
  }
  return { ok: true, ws, changed: changed ?? [], results }
}

// The render gate (Phase 5) owns global DOM state and the type checker is
// single-threaded, so verification runs one change at a time even when
// model calls run in parallel.
let lock: Promise<unknown> = Promise.resolve()

export function verifyChange(base: Workspace, cs: ChangeSet, key?: string, extraGates?: Gate[]): Promise<Verdict> {
  const next = lock.then(() => verifyChangeNow(base, cs, key, extraGates))
  lock = next.catch(() => {})
  return next
}

async function verifyChangeNow(base: Workspace, cs: ChangeSet, key?: string, extraGates?: Gate[]): Promise<Verdict> {
  const t0 = performance.now()
  const applied = applyChangeSet(base, cs)
  if (!applied.ws) {
    const gate = applied.diagnostics[0]?.gate ?? "policy"
    return { ok: false, changed: applied.changed, failedAt: gate, results: [{ gate, ok: false, ms: performance.now() - t0, diagnostics: applied.diagnostics }] }
  }
  return verifyWorkspace(applied.ws, applied.changed, key, base, extraGates)
}

/** Blocking diagnostics as text, for the repair prompt and for logs. */
export function formatDiagnostics(v: Verdict, limit = 12): string {
  const lines: string[] = []
  for (const r of v.results) {
    for (const d of r.diagnostics) {
      if (d.severity === "warning") continue
      const at = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""}` : ""
      lines.push(`[${d.gate} ${d.code}] ${at ? at + " " : ""}${d.message}`)
      for (const rel of d.related ?? []) lines.push(`    see ${rel.file}:${rel.line}  ${rel.text}`)
    }
  }
  const shown = lines.slice(0, limit)
  if (lines.length > limit) shown.push(`…and ${lines.length - limit} more`)
  return shown.join("\n")
}
