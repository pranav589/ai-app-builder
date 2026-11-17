import type { RunState } from "../core/types"
import type { Workspace } from "../core/workspace"
import { legacyCheck } from "../gates/legacy"
import { formatDiagnostics, verifyChange, type Verdict } from "../gates/pipeline"
import { projectPrompt, repairPrompt, SYSTEM_PROMPT } from "./context"
import { complete, type ChatMessage } from "./model"
import { parseReply } from "./protocol"

// One request = one run: write -> verify -> (repair -> verify)* -> committed | needs_user.
// The repair budget belongs to the run, so a run can never loop.

export const MAX_REPAIRS = 3

export type Attempt = {
  n: number
  modelMs: number
  gatesMs: number
  outputChars: number
  finishReason?: string | null
  tokens?: { prompt?: number; completion?: number }
  ok: boolean
  failedAt?: string
  diagnostics?: string
  files: string[]
  raw: string
  /** Would today's engine's checks have accepted this output? (see gates/legacy.ts) */
  legacyAccepted?: boolean
  legacyProblems?: string[]
}

export type RunReport = {
  request: string
  model: string
  state: RunState
  attempts: Attempt[]
  question?: string
  ws?: Workspace
  verdict?: Verdict
  totalMs: number
  intent?: string
}

export async function runChange(
  base: Workspace,
  request: string,
  opts: { model: string; onState?: (s: RunState, info?: string) => void; maxRepairs?: number; context?: "all" | "focused" }
): Promise<RunReport> {
  const t0 = performance.now()
  const maxRepairs = opts.maxRepairs ?? MAX_REPAIRS
  const emit = opts.onState ?? (() => {})
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT() },
    { role: "user", content: projectPrompt(base, request, opts.context ?? "all") },
  ]
  const attempts: Attempt[] = []
  emit("received")

  for (let n = 1; n <= maxRepairs + 1; n++) {
    emit(n === 1 ? "writing" : "repairing", n === 1 ? undefined : `round ${n - 1} of ${maxRepairs}`)
    const out = await complete(messages, { model: opts.model })
    messages.push({ role: "assistant", content: out.text })
    const parsed = parseReply(out.text)

    if (parsed.question && !parsed.changeSet.files.length) {
      attempts.push({ n, modelMs: out.ms, gatesMs: 0, outputChars: out.text.length, finishReason: out.finishReason, tokens: out.usage, ok: false, files: [], raw: out.text })
      emit("needs_user", parsed.question)
      return { request, model: opts.model, state: "needs_user", attempts, question: parsed.question, totalMs: performance.now() - t0 }
    }

    emit("verifying")
    const g0 = performance.now()
    let verdict: Verdict
    if (parsed.problems.length) {
      verdict = {
        ok: false,
        changed: [],
        failedAt: "parse",
        results: [{ gate: "parse", ok: false, ms: 0, diagnostics: parsed.problems.map((message) => ({ gate: "parse" as const, code: "protocol", message })) }],
      }
    } else {
      verdict = await verifyChange(base, parsed.changeSet)
    }
    const diagnostics = verdict.ok ? undefined : formatDiagnostics(verdict)
    const legacy = parsed.problems.length ? { accepted: false, problems: parsed.problems } : legacyCheck(base, parsed.changeSet)
    attempts.push({
      legacyAccepted: legacy.accepted,
      legacyProblems: legacy.problems,
      n,
      modelMs: out.ms,
      gatesMs: performance.now() - g0,
      outputChars: out.text.length,
      finishReason: out.finishReason,
      tokens: out.usage,
      ok: verdict.ok,
      failedAt: verdict.failedAt,
      diagnostics,
      files: parsed.changeSet.files.map((f) => `${f.op} ${f.path}`),
      raw: out.text,
    })

    if (verdict.ok) {
      emit("committed")
      return { request, model: opts.model, state: "committed", attempts, ws: verdict.ws, verdict, totalMs: performance.now() - t0, intent: parsed.changeSet.intent }
    }
    emit("verifying", `failed at ${verdict.failedAt}:\n${diagnostics}`)
    if (n <= maxRepairs) messages.push({ role: "user", content: repairPrompt(diagnostics!, n, maxRepairs + 1) })
  }

  emit("needs_user", "The change still failed verification after the repair budget. The app is unchanged.")
  return { request, model: opts.model, state: "needs_user", attempts, totalMs: performance.now() - t0 }
}
