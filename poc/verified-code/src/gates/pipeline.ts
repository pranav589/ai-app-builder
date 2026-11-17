import type { ChangeSet, GateResult } from "../core/types"
import { applyChangeSet, type Workspace } from "../core/workspace"
import { parseGate, policyGate } from "./parse-policy"
import { renderGate } from "./render"
import { createTypeChecker, type TypeChecker } from "./typecheck"

// Fast tier: cheapest first, stop at the first failing gate.

export type Verdict = {
  ok: boolean
  ws?: Workspace
  changed: string[]
  results: GateResult[]
  /** The first gate that failed, if any. */
  failedAt?: GateResult["gate"]
}

let shared: TypeChecker | null = null
export const typeChecker = () => (shared ??= createTypeChecker())

export async function verifyWorkspace(ws: Workspace, changed: string[] = []): Promise<Verdict> {
  const results: GateResult[] = []
  const steps: (() => GateResult | Promise<GateResult>)[] = [() => parseGate(ws), () => policyGate(ws), () => typeChecker().check(ws), () => renderGate(ws)]
  for (const step of steps) {
    const r = await step()
    results.push(r)
    if (!r.ok) return { ok: false, ws, changed, results, failedAt: r.gate }
  }
  return { ok: true, ws, changed, results }
}

// The render gate owns global DOM state and the type checker is single-threaded, so
// verification runs one change at a time even when model calls run in parallel.
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
    const gate = applied.diagnostics[0]?.gate ?? "manifest"
    return { ok: false, changed: applied.changed, failedAt: gate, results: [{ gate, ok: false, ms: performance.now() - t0, diagnostics: applied.diagnostics }] }
  }
  return verifyWorkspace(applied.ws, applied.changed)
}

/** Blocking diagnostics as text for people and for the repair prompt. */
export function formatDiagnostics(v: Verdict, limit = 12): string {
  const lines: string[] = []
  for (const r of v.results) {
    for (const d of r.diagnostics) {
      if (d.code === "warning") continue
      const at = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""}` : ""
      lines.push(`[${d.gate} ${d.code}] ${at ? at + " " : ""}${d.message}`)
      for (const rel of d.related ?? []) lines.push(`    see ${rel.file}:${rel.line}  ${rel.text}`)
    }
  }
  const shown = lines.slice(0, limit)
  if (lines.length > limit) shown.push(`…and ${lines.length - limit} more`)
  return shown.join("\n")
}
