import { isFatalProviderError, modelName } from "../agent/model"
import { runChange, type RunReport } from "../agent/run"
import { loadFixture } from "../core/workspace"
import { saveRunLog } from "../store/snapshots"
import { secs } from "./common"

// npm run eval [-- --model name] [--only 1,3] [--concurrency 4] [--focused]
// Runs a fixed set of requests against the base fixture (nothing is committed) and reports
// first-pass rate, repair rounds, time to a verified change, and how today's checks would
// have judged the same first outputs.

type Task = { category: "edit" | "screen" | "data" | "layout" | "logic" | "flow" | "ceiling"; text: string }

/** Requests the platform can't fully do. Good outcomes: a sensible fallback that passes, or a clear question. */
export const CEILING_TASKS: Task[] = [
  { category: "ceiling", text: "Show nearby gyms on a map so I can pick one to train at." },
  { category: "ceiling", text: "Send me a push notification every morning at 8am to remind me to check in." },
  { category: "ceiling", text: "Sync my habits to Google Sheets every night." },
  { category: "ceiling", text: "Let me swipe a habit card left to delete it, with a smooth animation." },
  { category: "ceiling", text: "Let me take a photo when I check in and show it in the history." },
  { category: "ceiling", text: "Make it better." },
]

export const TASKS: Task[] = [
  { category: "screen", text: "Add a Streaks tab that shows, for each habit, the number of check-ins as a large stat and a progress bar toward its weekly target." },
  { category: "logic", text: "On the habit detail screen, add a 'Check in today' button that creates an Entry for this habit with today's date (YYYY-MM-DD), and disable it if there is already an entry for today." },
  { category: "edit", text: "Show an empty state on the home screen when there are no habits, with a button that opens the New habit screen." },
  { category: "data", text: "Add a Settings screen reachable from the Profile tab with a 'Daily reminder' toggle and a 'Weekly summary' toggle, stored in a new Setting entity." },
  { category: "flow", text: "Let users edit a habit: add an Edit button on the habit detail screen that opens an edit screen with the title and target prefilled, and save the changes." },
  { category: "layout", text: "Redesign the home screen as a two-column grid of habit cards, each showing the title, a flame icon with the check-in count, and a progress bar." },
  { category: "data", text: "Add a notes field to habits and show it on the detail screen; allow entering it in the New habit form." },
  { category: "layout", text: "Add a calendar-style row of the last 7 days on the habit detail screen, highlighting days that have an entry." },
  { category: "flow", text: "Add an onboarding flow: a Welcome screen that is the first screen of the app, with a short intro and a 'Get started' button that goes to the Home tab." },
  { category: "logic", text: "On the home screen, show each habit's current streak: the number of consecutive days up to today that have an entry for that habit, using the Entry dates." },
  { category: "data", text: "Add categories: a Category entity with a name and a few seed categories, let habits optionally belong to a category, and show a row of category filter badges on the home screen." },
  { category: "logic", text: "In the New habit form, validate that the title is 3 to 40 characters and not already used by another habit (case-insensitive). Show an error message under the field and keep Save disabled until it is valid." },
  { category: "layout", text: "Add a weekly bar chart to the Profile tab showing check-ins per day for the last 7 days, built from Views whose heights are proportional to the counts, with day labels under the bars." },
  { category: "edit", text: "Change the home screen's 'New habit' button into a round floating button in the bottom-right corner of the screen." },
  { category: "logic", text: "Add a search field at the top of the home screen that filters habits by title as you type, with an empty state when nothing matches." },
  { category: "logic", text: "When deleting a habit on the detail screen, show an inline confirmation step (Are you sure? with Cancel and Delete) instead of deleting immediately, and also delete that habit's entries." },
  { category: "screen", text: "Add an Achievements tab listing badges the user can earn: 'First check-in', '10 check-ins' and 'Perfect week' (a habit with entries on 7 different days). Show unearned ones muted." },
  { category: "logic", text: "Add a three-option sort control on the home screen to sort habits by title, by target, or by most check-ins." },
  { category: "data", text: "Entries get a numeric 'amount' (default 1). On the habit detail screen, let the user check in with an amount typed into a small number field, and show the amount on each entry." },
  { category: "flow", text: "Add a journal: a JournalEntry entity with text and date, a Journal tab listing entries newest first, and a modal screen to write a new entry." },
  { category: "edit", text: "Rename the Profile tab to 'You' and show the total number of check-ins as a large stat at the top of it." },
  { category: "layout", text: "On the home screen, give each habit card a colored left accent bar: the theme's success color when the habit reached its target, the border color otherwise." },
  { category: "logic", text: "On the habit detail screen, show this week's completion rate as a percentage (entries in the last 7 days divided by the target, capped at 100%) with a progress bar." },
  { category: "edit", text: "Extract the habit card used on the home screen into a reusable component in components/home/HabitCard.tsx and use it there." },
  { category: "layout", text: "On the habit detail screen, replace the check-ins list with a 'Recent activity' section that groups entries by month, with a heading for each month." },
  { category: "layout", text: "Add a theme preview card on the Profile tab: a row of round color swatches for the app's primary, success and danger colors, each with a label." },
  { category: "logic", text: "Add a 'Reset all data' button on the Profile tab that removes all habits and all entries after an inline confirmation." },
  { category: "flow", text: "Add a 'History' screen opened from the habit detail screen that lists all entries of that habit, newest first, with a delete button on each entry." },
]

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const model = arg("--model") ?? modelName()
const only = arg("--only") ? new Set(arg("--only")!.split(",").map((n) => Number(n) - 1)) : null
const concurrency = Math.max(1, Number(arg("--concurrency") ?? 4))
const context = args.includes("--focused") ? "focused" : "all"

const set = arg("--set") === "ceiling" ? CEILING_TASKS : TASKS

const TASKS_TEXT = (n: number) => set[n - 1]?.text ?? ""
const base = loadFixture()
const queue = set.map((t, i) => ({ ...t, n: i + 1 })).filter((t) => !only || only.has(t.n - 1))
const rows: { task: number; category: Task["category"]; report?: RunReport; error?: string }[] = []
console.log(`Model ${model} · ${queue.length} task(s) · concurrency ${concurrency} · context ${context}\n`)
const started = performance.now()

async function worker() {
  for (let t = queue.shift(); t; t = queue.shift()) {
    try {
      const report = await runChange(base, t.text, { model, context })
      rows.push({ task: t.n, category: t.category, report })
      const fails = report.attempts.filter((a) => !a.ok).map((a) => a.failedAt ?? "question")
      console.log(`#${String(t.n).padStart(2)} ${t.category.padEnd(6)} ${report.state} · ${report.attempts.length} attempt(s) · ${secs(report.totalMs)}${fails.length ? ` · failed at ${fails.join(", ")}` : ""}`)
    } catch (e) {
      rows.push({ task: t.n, category: t.category, error: e instanceof Error ? e.message : String(e) })
      console.log(`#${String(t.n).padStart(2)} ${t.category.padEnd(6)} error: ${e instanceof Error ? e.message : e}`)
      if (isFatalProviderError(e)) {
        // Billing or auth: every other task would fail the same way.
        if (queue.length) console.log(`Stopping: ${queue.length} remaining task(s) skipped.`)
        queue.length = 0
      }
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))

const done = rows.filter((r) => r.report).sort((a, b) => a.task - b.task) as { task: number; category: Task["category"]; report: RunReport }[]
const n = done.length
const pct = (x: number, of = n) => (of ? `${Math.round((x / of) * 100)}%` : "-")
const firstPass = done.filter((r) => r.report.attempts[0]?.ok).length
const committed = done.filter((r) => r.report.state === "committed").length
const repairs = done.reduce((s, r) => s + Math.max(0, r.report.attempts.length - 1), 0)
const times = done.filter((r) => r.report.state === "committed").map((r) => r.report.totalMs).sort((a, b) => a - b)
const q = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))] : 0)
const attempts = done.flatMap((r) => r.report.attempts)
const modelMs = attempts.reduce((s, a) => s + a.modelMs, 0)
const gateMs = attempts.reduce((s, a) => s + a.gatesMs, 0)
const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number")
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0
}

// Today's checks vs full gates, on the model's first output for each task.
const first = done.map((r) => r.report.attempts[0]).filter(Boolean)
const escaped = first.filter((a) => a.legacyAccepted && !a.ok)
const caughtByBoth = first.filter((a) => !a.legacyAccepted && !a.ok).length
const falseAlarms = first.filter((a) => !a.legacyAccepted && a.ok).length

const byGate: Record<string, number> = {}
for (const a of attempts) {
  if (a.ok) continue
  const code = /^\[(\w+) ([\w_]+)\]/.exec(a.diagnostics ?? "")
  const k = code ? `${code[1]} ${code[2]}` : (a.failedAt ?? "question")
  byGate[k] = (byGate[k] ?? 0) + 1
}

const cats = [...new Set(done.map((r) => r.category))]
console.log(`
Wall time                    ${secs(performance.now() - started)}
Tasks                        ${n}${rows.length - n ? ` (+${rows.length - n} errored)` : ""}
Passed on first attempt      ${firstPass}/${n} (${pct(firstPass)})
Verified and committed       ${committed}/${n} (${pct(committed)})
Ended in needs_user          ${n - committed}/${n}
Repair rounds (total)        ${repairs}
Time to verified, p50 / p90  ${secs(q(0.5))} / ${secs(q(0.9))}
Model vs gate time           ${secs(modelMs)} vs ${secs(gateMs)}
Avg tokens in / out          ${avg(attempts.map((a) => a.tokens?.prompt))} / ${avg(attempts.map((a) => a.tokens?.completion))}

First outputs judged by today's checks vs the full gates
  Broken, but today's checks would accept   ${escaped.length}/${first.length}
  Broken, and today's checks also reject    ${caughtByBoth}
  Fine, but today's checks reject           ${falseAlarms}

Rejections by gate and code   ${Object.entries(byGate).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ×${c}`).join(", ") || "none"}

First-pass rate by category
${cats.map((c) => {
  const rs = done.filter((r) => r.category === c)
  const fp = rs.filter((r) => r.report.attempts[0]?.ok).length
  const ok = rs.filter((r) => r.report.state === "committed").length
  return `  ${c.padEnd(7)} first pass ${fp}/${rs.length}, committed ${ok}/${rs.length}`
}).join("\n")}`)

if (set === CEILING_TASKS) {
  console.log("\nOutcomes for requests beyond the platform:")
  for (const r of done) {
    const rep = r.report
    const wasted = rep.state === "needs_user" && !rep.question
    const outcome = rep.question ? `asked: ${rep.question}` : rep.state === "committed" ? `built fallback: ${rep.intent}` : "gave up after the repair budget"
    console.log(`  #${r.task} ${wasted ? "✗" : "✓"} ${TASKS_TEXT(r.task)}\n      ${outcome.replace(/\s+/g, " ").slice(0, 260)}`)
  }
}

if (escaped.length) {
  console.log("\nWhat today's checks would have let through:")
  for (const r of done) {
    const a = r.report.attempts[0]
    if (a && a.legacyAccepted && !a.ok) console.log(`  #${r.task}: ${(a.diagnostics ?? "").split("\n")[0].slice(0, 200)}`)
  }
}

const file = saveRunLog(
  `eval-${model.replace(/[^\w.-]+/g, "_")}-${set === CEILING_TASKS ? "ceiling" : context}-${Date.now()}`,
  done.map((r) => ({ task: r.task, category: r.category, ...r.report, ws: undefined, verdict: undefined }))
)
console.log(`\nFull log: ${file}`)
process.exit(0)
