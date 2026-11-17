import { loadFixture } from "../core/workspace"
import { formatDiagnostics, verifyWorkspace } from "../gates/pipeline"
import { commit } from "../store/snapshots"
import { exportHead } from "./common"

// Starts a project from the base fixture: verify it, commit it as the first snapshot.

const ws = loadFixture()
const v = await verifyWorkspace(ws)
if (!v.ok) {
  console.error("The base fixture fails verification:\n" + formatDiagnostics(v))
  process.exit(1)
}
const snap = commit(ws, { author: "compiler", intent: "Initial app from fixtures/base" })
console.log(`Committed ${snap.id} (${Object.keys(snap.tree).length} files). HEAD -> ${snap.id}`)
console.log(`App files written to ${exportHead(ws)}`)
process.exit(0)
