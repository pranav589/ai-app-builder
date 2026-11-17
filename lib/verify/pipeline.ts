// Fast tier: cheapest gate first, stop at the first failure. Phase 4 adds
// `tsc` and Phase 5 adds `render` to GATES; nothing else here changes.

import type { ChangeSet, GateName, GateResult, Workspace } from "./types"
import { applyChangeSet } from "./workspace"
import { parseGate } from "./gates/parse"
import { policyGate } from "./gates/policy"

export type Verdict = {
  ok: boolean
  ws?: Workspace
  changed: string[]
  results: GateResult[]
  /** The first gate that failed, if any. */
  failedAt?: GateName
}

type Gate = (ws: Workspace, changed?: string[]) => GateResult | Promise<GateResult>

const GATES: Gate[] = [parseGate, policyGate]

/**
 * `changed` scopes parse/policy to the files this attempt actually touched,
 * so a project with pre-existing files that predate these rules (migrated
 * from the legacy engine, or just older) isn't blocked by problems an edit
 * elsewhere didn't create. Omit it to check everything (a fresh build).
 */
export async function verifyWorkspace(ws: Workspace, changed?: string[]): Promise<Verdict> {
  const results: GateResult[] = []
  for (const gate of GATES) {
    const r = await gate(ws, changed)
    results.push(r)
    if (!r.ok) return { ok: false, ws, changed: changed ?? [], results, failedAt: r.gate }
  }
  return { ok: true, ws, changed: changed ?? [], results }
}

// The render gate (Phase 5) owns global DOM state and a future type checker
// (Phase 4) is single-threaded, so verification runs one change at a time
// even when model calls run in parallel.
let lock: Promise<unknown> = Promise.resolve()

export function verifyChange(base: Workspace, cs: ChangeSet): Promise<Verdict> {
  const next = lock.then(() => verifyChangeNow(base, cs))
  lock = next.catch(() => {})
  return next
}

async function verifyChangeNow(base: Workspace, cs: ChangeSet): Promise<Verdict> {
  const t0 = performance.now()
  const applied = applyChangeSet(base, cs)
  if (!applied.ws) {
    const gate = applied.diagnostics[0]?.gate ?? "policy"
    return { ok: false, changed: applied.changed, failedAt: gate, results: [{ gate, ok: false, ms: performance.now() - t0, diagnostics: applied.diagnostics }] }
  }
  return verifyWorkspace(applied.ws, applied.changed)
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
