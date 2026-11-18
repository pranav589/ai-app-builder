// Runs the fixed task set (eval/tasks.ts) against a fixture, entirely in
// memory (no DB, no commits), through the real change gateway (lib/verify/*):
// write -> verify -> repair x<=3 -> committed | needs_user. Reports
// first-pass rate, repair rounds, time to verified, token use, and
// rejections by gate. Also judges each first attempt against the simpler,
// pre-gateway checks (eval/legacy-check.ts, kept only as a lighter baseline
// for this comparison) to show how much the full gate pipeline actually buys
// over a quick regex/noResolve check.
//
// Usage: npm run eval -- --fixture <name> [--only 1,3] [--concurrency 4] [--context all|focused]
//
// --context (default "focused") controls how much of the app each model call
// sees. "focused" sends only the first ready screen plus whatever local
// components/lib files it imports -- the same default the real edit path
// falls back to for a request that doesn't name a screen
// (lib/agent/orchestrator.ts runVerifiedEdit: `if (!targetPaths.size &&
// ready[0]) ...`), so this mirrors what a real underspecified request would
// actually cost. "all" sends every app-owned file on every call instead (the
// POC's default): far more faithful to "the model can see the whole app",
// but multiplies token cost by the number of screens, which gets expensive
// fast on a fixture with several large screens (e.g. ~4x on a 4-screen
// fixture). The real edit path always scopes to the targets a chat message
// actually names, so neither eval mode's cost reflects real per-edit chat
// cost exactly -- "focused" is just the closer approximation.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { AppDoc } from "@/lib/app-runtime/app-doc"
import type { AppPlan } from "@/lib/agent/types"
import { emptyDataModel } from "@/lib/app-runtime/data-model"
import { projectExports } from "@/lib/app-project/project"
import { coderAdapter } from "@/lib/verify/coder"
import { ensureManifest } from "@/lib/manifest/migrate"
import type { AppManifest } from "@/lib/manifest/schema"
import { selectFiles } from "@/lib/verify/context"
import { formatDiagnostics, verifyChange, type Verdict } from "@/lib/verify/pipeline"
import { verifiedEditPrompt, repairPrompt } from "@/lib/verify/prompts"
import { parseReply } from "@/lib/verify/protocol"
import type { GateName, Workspace } from "@/lib/verify/types"
import { isAppOwned } from "@/lib/verify/ownership"
import { workspaceFromDoc } from "@/lib/verify/workspace"
import { legacyCheck } from "../eval/legacy-check"
import { CEILING_TASKS, TASKS, type Task } from "../eval/tasks"

type Context = "all" | "focused"

const MAX_REPAIRS = 3

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const fixtureName = arg("--fixture")
if (!fixtureName) {
  console.error("Usage: npm run eval -- --fixture <name> [--only 1,3] [--concurrency 4] [--context all|focused]")
  process.exit(1)
}
const only = arg("--only") ? new Set(arg("--only")!.split(",").map((n) => Number(n) - 1)) : null
const concurrency = Math.max(1, Number(arg("--concurrency") ?? 4))
const context = (arg("--context") ?? "focused") as Context
if (context !== "all" && context !== "focused") {
  console.error(`--context must be "all" or "focused"`)
  process.exit(1)
}

const fixturePath = path.join(process.cwd(), "eval", "fixtures", `${fixtureName}.json`)
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { plan: AppPlan; doc: AppDoc }
const manifestOrNull = ensureManifest(fixture.doc, fixture.plan)
if (!manifestOrNull) {
  console.error(`Fixture "${fixtureName}" has no manifest and no plan to build one from.`)
  process.exit(1)
}
const manifest: AppManifest = manifestOrNull
const base: Workspace = workspaceFromDoc({ ...fixture.doc, manifest })
const ready = fixture.doc.screens.filter((s) => s.state === "ready" && s.code && s.path)
const appFiles = Object.entries(base.files)
  .filter(([p]) => isAppOwned(p))
  .map(([path, code]) => ({ path, code }))

/** The first ready screen plus the local components/lib files it imports (one level); lib/verify/context.ts selectFiles, the same scoping the real edit path (runVerifiedEdit) falls back to for a request that doesn't name a screen. */
const focusedFiles = selectFiles(base, ready[0]?.path ? [ready[0].path] : [])

function buildPrompt(task: Task) {
  return verifiedEditPrompt(task.text, context === "all" ? appFiles : focusedFiles, {
    manifest,
    components: Object.entries(projectExports(base.files)).map(([n, e]) => `${n} (${e.module})`).join(", "),
    data: fixture.doc.data ?? emptyDataModel(),
  })
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

const isFatalProviderError = (e: unknown) => /\b(401|402|403)\b|insufficient_quota|billing/i.test(e instanceof Error ? e.message : String(e))

/** Warning-severity diagnostics never block, so they don't appear in formatDiagnostics; tallied separately to report the ones worth promoting to blocking later. */
const warningTally: Record<string, number> = {}
function tallyWarnings(verdict: Verdict) {
  for (const r of verdict.results) for (const d of r.diagnostics) if (d.severity === "warning") warningTally[`${d.gate} ${d.code}`] = (warningTally[`${d.gate} ${d.code}`] ?? 0) + 1
}

type AttemptLog = {
  n: number
  modelMs: number
  gatesMs: number
  ok: boolean
  failedAt?: GateName
  diagnostics?: string
  tokens?: { prompt?: number; completion?: number }
  /** Would today's (legacy) checks have accepted this same attempt's output? */
  legacyAccepted?: boolean
  legacyProblems?: string[]
}

type TaskResult = {
  task: number
  category: Task["category"]
  text: string
  state: "committed" | "needs_user"
  question?: string
  intent?: string
  attempts: AttemptLog[]
  totalMs: number
}

type Turn = { role: "user" | "assistant"; content: string }

/** The real change gateway: write -> verify -> repair x<=MAX_REPAIRS -> committed | needs_user. */
async function runVerified(task: Task, n: number): Promise<TaskResult> {
  const t0 = performance.now()
  const turns: Turn[] = [{ role: "user", content: buildPrompt(task) }]
  const attempts: AttemptLog[] = []

  for (let a = 1; a <= MAX_REPAIRS + 1; a++) {
    const out = await coderAdapter(turns)
    turns.push({ role: "assistant", content: out.text })
    const parsed = parseReply(out.text)

    if (parsed.question && !parsed.changeSet.files.length) {
      attempts.push({ n: a, modelMs: out.modelMs, gatesMs: 0, ok: false, tokens: out.tokens })
      return { task: n, category: task.category, text: task.text, state: "needs_user", question: parsed.question, attempts, totalMs: performance.now() - t0 }
    }

    const g0 = performance.now()
    const legacy = parsed.problems.length ? { accepted: false, problems: parsed.problems } : legacyCheck(base, parsed.changeSet)
    let verdict: Verdict
    if (parsed.problems.length) {
      verdict = {
        ok: false,
        changed: [],
        failedAt: "parse",
        results: [{ gate: "parse", ok: false, ms: 0, diagnostics: parsed.problems.map((message) => ({ gate: "parse" as const, code: "protocol", severity: "error" as const, message })) }],
      }
    } else {
      verdict = await verifyChange(base, parsed.changeSet, fixtureName)
      tallyWarnings(verdict)
    }
    const diagnostics = verdict.ok ? undefined : formatDiagnostics(verdict)
    attempts.push({
      n: a,
      modelMs: out.modelMs,
      gatesMs: performance.now() - g0,
      ok: verdict.ok,
      failedAt: verdict.failedAt,
      diagnostics,
      tokens: out.tokens,
      legacyAccepted: legacy.accepted,
      legacyProblems: legacy.problems,
    })

    if (verdict.ok) return { task: n, category: task.category, text: task.text, state: "committed", intent: parsed.changeSet.intent, attempts, totalMs: performance.now() - t0 }
    if (a <= MAX_REPAIRS) turns.push({ role: "user", content: repairPrompt(diagnostics!, a, MAX_REPAIRS + 1) })
  }
  return { task: n, category: task.category, text: task.text, state: "needs_user", attempts, totalMs: performance.now() - t0 }
}

const runTask = runVerified

const queue = [...TASKS, ...CEILING_TASKS].map((t, i) => ({ ...t, n: i + 1 })).filter((t) => !only || only.has(t.n - 1))
const rows: { task: number; category: Task["category"]; result?: TaskResult; error?: string }[] = []

console.log(`fixture ${fixtureName} · context ${context} · ${queue.length} task(s) · concurrency ${concurrency}\n`)
const started = performance.now()

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})

async function main() {

async function worker() {
  for (let t = queue.shift(); t; t = queue.shift()) {
    try {
      const result = await runTask(t, t.n)
      rows.push({ task: t.n, category: t.category, result })
      const fails = result.attempts.filter((a) => !a.ok).map((a) => a.failedAt ?? "question")
      console.log(`#${String(t.n).padStart(2)} ${t.category.padEnd(7)} ${result.state} · ${result.attempts.length} attempt(s) · ${secs(result.totalMs)}${fails.length ? ` · failed at ${fails.join(", ")}` : ""}`)
    } catch (e) {
      rows.push({ task: t.n, category: t.category, error: e instanceof Error ? e.message : String(e) })
      console.log(`#${String(t.n).padStart(2)} ${t.category.padEnd(7)} error: ${e instanceof Error ? e.message : e}`)
      if (isFatalProviderError(e)) {
        if (queue.length) console.log(`Stopping: ${queue.length} remaining task(s) skipped (provider billing/auth error).`)
        queue.length = 0
      }
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

const done = rows.filter((r) => r.result).sort((a, b) => a.task - b.task) as { task: number; category: Task["category"]; result: TaskResult }[]
const n = done.length
const pct = (x: number, of = n) => (of ? `${Math.round((x / of) * 100)}%` : "-")
const firstPass = done.filter((r) => r.result.attempts[0]?.ok).length
const committed = done.filter((r) => r.result.state === "committed").length
const repairs = done.reduce((s, r) => s + Math.max(0, r.result.attempts.length - 1), 0)
const times = done.filter((r) => r.result.state === "committed").map((r) => r.result.totalMs).sort((a, b) => a - b)
const quantile = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))] : 0)
const attempts = done.flatMap((r) => r.result.attempts)
const modelMs = attempts.reduce((s, a) => s + a.modelMs, 0)
const gateMs = attempts.reduce((s, a) => s + a.gatesMs, 0)
const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number")
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0
}

// Today's checks vs the full gates, on the model's first output for each task.
const first = done.map((r) => r.result.attempts[0]).filter(Boolean)
const escaped = first.filter((a) => a.legacyAccepted && !a.ok)
const caughtByBoth = first.filter((a) => !a.legacyAccepted && !a.ok).length
const falseAlarms = first.filter((a) => !a.legacyAccepted && a.ok).length

const byGate: Record<string, number> = {}
for (const a of attempts) {
  if (a.ok) continue
  const m = /^\[(\w+) ([\w_]+)\]/.exec(a.diagnostics ?? "")
  const k = m ? `${m[1]} ${m[2]}` : (a.failedAt ?? "question")
  byGate[k] = (byGate[k] ?? 0) + 1
}

const cats = [...new Set(done.map((r) => r.category))]
console.log(`
Wall time                    ${secs(performance.now() - started)}
Tasks                        ${n}${rows.length - n ? ` (+${rows.length - n} errored)` : ""}
Passed on first attempt       ${firstPass}/${n} (${pct(firstPass)})
Verified and committed        ${committed}/${n} (${pct(committed)})
Ended in needs_user            ${n - committed}/${n}
Repair rounds (total)         ${repairs}
Time to verified, p50 / p90   ${secs(quantile(0.5))} / ${secs(quantile(0.9))}
Model vs gate time            ${secs(modelMs)} vs ${secs(gateMs)}
Avg tokens in / out            ${avg(attempts.map((a) => a.tokens?.prompt))} / ${avg(attempts.map((a) => a.tokens?.completion))}

First outputs judged by today's checks vs the full gates
  Broken, but today's checks would accept    ${escaped.length}/${first.length}
  Broken, and today's checks also reject     ${caughtByBoth}
  Fine, but today's checks reject            ${falseAlarms}

Rejections by gate and code   ${Object.entries(byGate).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ×${c}`).join(", ") || "none"}
${Object.keys(warningTally).length ? `
Most common warnings (never blocked; candidates to promote later)
${Object.entries(warningTally).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, c]) => `  ${k} ×${c}`).join("\n")}
` : ""}
First-pass rate by category
${cats
  .map((c) => {
    const rs = done.filter((r) => r.category === c)
    const fp = rs.filter((r) => r.result.attempts[0]?.ok).length
    const ok = rs.filter((r) => r.result.state === "committed").length
    return `  ${c.padEnd(7)} first pass ${fp}/${rs.length}, committed ${ok}/${rs.length}`
  })
  .join("\n")}`)

const ceilingDone = done.filter((r) => r.category === "ceiling")
if (ceilingDone.length) {
  console.log("\nOutcomes for requests beyond the platform:")
  for (const r of ceilingDone) {
    const rep = r.result
    const wasted = rep.state === "needs_user" && !rep.question
    const outcome = rep.question ? `asked: ${rep.question}` : rep.state === "committed" ? `built a fallback: ${rep.intent}` : "gave up after the repair budget"
    console.log(`  #${r.task} ${wasted ? "✗" : "✓"} ${rep.text}\n      ${outcome.replace(/\s+/g, " ").slice(0, 260)}`)
  }
}

if (escaped.length) {
  console.log("\nWhat today's checks would have let through:")
  for (const r of done) {
    const a = r.result.attempts[0]
    if (a && a.legacyAccepted && !a.ok) console.log(`  #${r.task}: ${(a.diagnostics ?? "").split("\n")[0].slice(0, 200)}`)
  }
}

const runsDir = path.join(process.cwd(), "eval", "runs")
mkdirSync(runsDir, { recursive: true })
const logFile = path.join(runsDir, `${Date.now()}-${fixtureName}.json`)
writeFileSync(logFile, JSON.stringify({ fixture: fixtureName, context, startedAt: new Date().toISOString(), rows: done.map((r) => r.result) }, null, 2))
console.log(`\nFull log: ${logFile}`)
process.exit(0)
}
