import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { CHAIN_STEPS, chainSize, runChainSteps } from "../agent/chain"
import { modelName } from "../agent/model"
import { POC_ROOT } from "../core/workspace"
import { verifyWorkspace } from "../gates/pipeline"
import { previewHtml } from "../preview/build"
import { saveRunLog } from "../store/snapshots"
import { secs } from "./common"

// npm run chain [-- --focused] [--model name]
// Ten changes applied one after another, each on top of the previous verified app, the
// way a real user builds. Shows whether reliability, prompt size and time hold up as the
// app grows. Runs in memory (HEAD is not touched) and previews the final app.

const args = process.argv.slice(2)
const modelIdx = args.indexOf("--model")
const model = modelIdx >= 0 ? args[modelIdx + 1] : modelName()
const context = args.includes("--focused") ? "focused" : "all"

console.log(`Model ${model} · context ${context} · ${CHAIN_STEPS.length} sequential changes\n`)
console.log("Step  Result        Tries  Time   Tokens in  App size")
const log: unknown[] = []
const t0 = performance.now()

const { ws } = await runChainSteps({
  model,
  context,
  onStep: (r, w) => {
    if (r.stopped) {
      console.log(`${String(r.n).padStart(4)}  stopped: ${r.stopped}`)
    } else {
      const report = r.report!
      const s = chainSize(w)
      const tokens = report.attempts[0]?.tokens?.prompt ?? 0
      console.log(
        `${String(r.n).padStart(4)}  ${report.state.padEnd(12)}  ${String(report.attempts.length).padStart(5)}  ${secs(report.totalMs).padStart(5)}  ${String(tokens).padStart(9)}  ${s.screens} screens, ${s.files} files, ${s.lines} lines${report.attempts.some((a) => !a.ok) ? `  (rejected: ${report.attempts.filter((a) => !a.ok).map((a) => a.failedAt).join(", ")})` : ""}`
      )
    }
    log.push(r.stopped ? { step: r.n, stopped: r.stopped } : { step: r.n, ...r.report, ws: undefined, verdict: undefined, size: chainSize(w) })
  },
})

// The final app must still pass every gate as a whole.
const final = await verifyWorkspace(ws)
const out = path.join(POC_ROOT, ".data", "preview")
mkdirSync(out, { recursive: true })
const file = path.join(out, `chain-${context}.html`)
writeFileSync(file, await previewHtml(ws, `Chain (${context})`))
console.log(`\nFinal app passes all gates: ${final.ok ? "yes" : "NO"} · total ${secs(performance.now() - t0)}`)
console.log(`Preview: ${file}`)
console.log(`Log: ${saveRunLog(`chain-${model.replace(/[^\w.-]+/g, "_")}-${context}-${Date.now()}`, log)}`)
process.exit(0)
