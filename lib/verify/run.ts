// The run state machine: write -> verify -> (repair -> verify)x<=maxRepairs ->
// committed | needs_user. The repair budget belongs to the run, so a run can
// never loop. Model-agnostic (ModelAdapter) so it can be unit tested with a
// fake model and exercised for real from lib/verify/coder.ts.

import type { GateName, RunState, Workspace } from "./types"
import { formatDiagnostics, verifyChange, type Verdict } from "./pipeline"
import { repairPrompt } from "./prompts"
import { parseReply } from "./protocol"

export const MAX_REPAIRS = 3

export type Turn = { role: "user" | "assistant"; content: string }

export type ModelReply = {
  text: string
  modelMs: number
  tokens?: { prompt?: number; completion?: number }
}

/** `onDelta`, when given, is called with each streamed chunk of the model's reply as it arrives. */
export type ModelAdapter = (turns: Turn[], onDelta?: (delta: string) => void) => Promise<ModelReply>

export type Attempt = {
  n: number
  modelMs: number
  gatesMs: number
  ok: boolean
  failedAt?: GateName
  diagnostics?: string
  files: string[]
  tokens?: { prompt?: number; completion?: number }
}

export type RunResult =
  | { state: "committed"; ws: Workspace; changed: string[]; intent: string; attempts: Attempt[] }
  | { state: "needs_user"; reason: "question" | "exhausted"; message: string; attempts: Attempt[] }

export type RunOpts = {
  maxRepairs?: number
  onState?: (s: RunState, info?: string) => void
  /** VERIFY_DEBUG_FAIL: makes `gate` fail the first `n` attempts with a synthetic diagnostic. */
  debugFail?: { gate: GateName; n: number }
  /** Identifies this project to the tsc gate's warm-LanguageService cache (lib/verify/gates/typecheck.ts). */
  projectKey?: string
  /** Streamed chunks of the model's reply for the attempt in progress, if the adapter supports it. */
  onDelta?: (delta: string) => void
}

export async function runChange(base: Workspace, userPrompt: string, model: ModelAdapter, opts: RunOpts = {}): Promise<RunResult> {
  const maxRepairs = opts.maxRepairs ?? MAX_REPAIRS
  const emit = opts.onState ?? (() => {})
  const turns: Turn[] = [{ role: "user", content: userPrompt }]
  const attempts: Attempt[] = []
  emit("received")

  for (let n = 1; n <= maxRepairs + 1; n++) {
    emit(n === 1 ? "writing" : "repairing", n === 1 ? undefined : `round ${n - 1} of ${maxRepairs}`)
    const out = await model(turns, opts.onDelta)
    turns.push({ role: "assistant", content: out.text })
    const parsed = parseReply(out.text)

    if (parsed.question && !parsed.changeSet.files.length) {
      attempts.push({ n, modelMs: out.modelMs, gatesMs: 0, ok: false, files: [], tokens: out.tokens })
      emit("needs_user", parsed.question)
      return { state: "needs_user", reason: "question", message: parsed.question, attempts }
    }

    emit("verifying")
    const g0 = performance.now()
    let verdict: Verdict
    if (parsed.problems.length) {
      verdict = {
        ok: false,
        changed: [],
        failedAt: "parse",
        results: [{ gate: "parse", ok: false, ms: 0, diagnostics: parsed.problems.map((message) => ({ gate: "parse" as const, code: "protocol", severity: "error" as const, message })) }],
      }
    } else if (opts.debugFail && n <= opts.debugFail.n) {
      verdict = {
        ok: false,
        changed: [],
        failedAt: opts.debugFail.gate,
        results: [
          {
            gate: opts.debugFail.gate,
            ok: false,
            ms: 0,
            diagnostics: [{ gate: opts.debugFail.gate, code: "debug_fail", severity: "error", message: `Synthetic failure from VERIFY_DEBUG_FAIL (attempt ${n}).` }],
          },
        ],
      }
    } else {
      verdict = await verifyChange(base, parsed.changeSet, opts.projectKey)
    }
    const diagnostics = verdict.ok ? undefined : formatDiagnostics(verdict)
    attempts.push({
      n,
      modelMs: out.modelMs,
      gatesMs: performance.now() - g0,
      ok: verdict.ok,
      failedAt: verdict.failedAt,
      diagnostics,
      files: parsed.changeSet.files.map((f) => `${f.op} ${f.path}`),
      tokens: out.tokens,
    })

    if (verdict.ok) {
      emit("committed")
      return { state: "committed", ws: verdict.ws!, changed: verdict.changed, intent: parsed.changeSet.intent, attempts }
    }
    emit("verifying", `failed at ${verdict.failedAt}: ${diagnostics}`)
    if (n <= maxRepairs) turns.push({ role: "user", content: repairPrompt(diagnostics!, n, maxRepairs + 1) })
  }

  const message = "The change still failed verification after the repair budget. The app is unchanged."
  emit("needs_user", message)
  return { state: "needs_user", reason: "exhausted", message, attempts }
}
