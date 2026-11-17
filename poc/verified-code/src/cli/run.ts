import { runChange } from "../agent/run"
import { modelName } from "../agent/model"
import { loadFixture } from "../core/workspace"
import { checkout, commit, head, saveRunLog } from "../store/snapshots"
import { exportHead, secs } from "./common"

// npm run run -- "Add a streaks tab" [--dry] [--model name]
// Runs one change against HEAD. Commits only if every fast gate passes.

const args = process.argv.slice(2)
const dry = args.includes("--dry")
const modelIdx = args.indexOf("--model")
const model = modelIdx >= 0 ? args[modelIdx + 1] : modelName()
const request = args
  .filter((a, i) => !a.startsWith("--") && !(modelIdx >= 0 && i === modelIdx + 1))
  .join(" ")
  .trim()
if (!request) {
  console.error('Usage: npm run run -- "your change request" [--dry] [--model name]')
  process.exit(1)
}

let headId = head()
if (!headId) {
  headId = commit(loadFixture(), { author: "compiler", intent: "Initial app from fixtures/base" }).id
  console.log(`No project yet: committed the base fixture as ${headId}.`)
}
const base = checkout(headId)
console.log(`HEAD ${headId} · model ${model}\nRequest: ${request}\n`)

const report = await runChange(base, request, {
  model,
  onState: (s, info) => console.log(`[${s}]${info ? " " + info.replace(/\n/g, "\n    ") : ""}`),
})

for (const a of report.attempts) {
  console.log(
    `  attempt ${a.n}: model ${secs(a.modelMs)}, gates ${secs(a.gatesMs)}, ${a.outputChars} chars${a.finishReason && a.finishReason !== "stop" ? ` (finish: ${a.finishReason})` : ""} -> ${a.ok ? "pass" : `fail at ${a.failedAt}`}`
  )
  console.log(`    ${a.files.join(", ") || "(no files)"}`)
}

let committed: string | undefined
if (report.state === "committed" && report.ws && !dry) {
  committed = commit(report.ws, { author: "ai", intent: report.intent || request }).id
  console.log(`\nCommitted ${committed} (parent ${headId}). App files: ${exportHead(report.ws)}`)
} else if (report.state === "committed") {
  console.log("\nPassed all gates (dry run, not committed).")
} else {
  console.log(`\nNot committed. HEAD is still ${headId}; the app is unchanged.${report.question ? `\nQuestion for the user: ${report.question}` : ""}`)
}
const log = saveRunLog(`${Date.now()}`, { ...report, ws: undefined, verdict: undefined, head: headId, committed })
console.log(`Total ${secs(report.totalMs)}. Run log: ${log}`)
process.exit(0)
