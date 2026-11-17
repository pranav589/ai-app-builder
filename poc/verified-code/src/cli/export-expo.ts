import path from "node:path"

import { runChainSteps } from "../agent/chain"
import { modelName } from "../agent/model"
import { checkout, head } from "../store/snapshots"
import { loadFixture, POC_ROOT } from "../core/workspace"
import { verifyWorkspace, formatDiagnostics } from "../gates/pipeline"
import { exportExpoProject } from "../expo/export"
import { secs } from "./common"

// npm run export:expo [-- --base | --chain | --focused] [--model name] [--out dir]
// Writes a real, installable Expo SDK 58 project so the AI-written code can be run with
// `npx expo start` and opened in Expo Go on a real phone — not react-native-web, not jsdom.
//
//   --base    export the base fixture as-is (fastest, no model calls)
//   --chain   build the 10-step chain fresh, then export the result (default)
//   (no flag) export the current HEAD snapshot (from `npm run change` / `npm run init`)

const args = process.argv.slice(2)
const modelIdx = args.indexOf("--model")
const model = modelIdx >= 0 ? args[modelIdx + 1] : modelName()
const context = args.includes("--focused") ? "focused" : "all"
const outIdx = args.indexOf("--out")
const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(POC_ROOT, ".data", "expo-app")

let ws
if (args.includes("--base")) {
  ws = loadFixture()
  console.log("Exporting the base fixture (no model calls).")
} else if (args.includes("--chain")) {
  console.log(`Building the 10-step chain fresh (model ${model}, context ${context}) before exporting…\n`)
  const t0 = performance.now()
  const result = await runChainSteps({
    model,
    context,
    onStep: (r) => console.log(r.stopped ? `  #${r.n} stopped: ${r.stopped}` : `  #${r.n} ${r.report!.state} (${r.report!.attempts.length} attempt(s), ${secs(r.report!.totalMs)})`),
  })
  ws = result.ws
  console.log(`\nChain built in ${secs(performance.now() - t0)}.`)
} else {
  const id = head()
  if (!id) {
    console.error("No HEAD snapshot yet. Run `npm run init` first, or pass --base / --chain.")
    process.exit(1)
  }
  ws = checkout(id)
  console.log(`Exporting HEAD snapshot ${id}.`)
}

const verdict = await verifyWorkspace(ws)
if (!verdict.ok) {
  console.error(`The app to export fails verification — refusing to export unverified code:\n${formatDiagnostics(verdict)}`)
  process.exit(1)
}

exportExpoProject(ws, outDir)
console.log(`\nExported to ${outDir}`)
console.log(`\nNext:\n  cd ${path.relative(process.cwd(), outDir) || "."}\n  npm install\n  npx expo start\n`)
console.log("Then open the printed exp:// URL in Expo Go, or scan the QR code. Same network required; try --tunnel if that fails.")
process.exit(0)
