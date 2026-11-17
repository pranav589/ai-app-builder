import { checkout, head, history, setHead } from "../store/snapshots"
import { exportHead } from "./common"

// npm run history            list snapshots from HEAD back
// npm run history -- --undo  move HEAD to its parent (nothing is deleted)

if (!head()) {
  console.log("No snapshots yet. Run: npm run init")
  process.exit(0)
}
if (process.argv.includes("--undo")) {
  const [current, previous] = history()
  if (!previous) {
    console.log("Already at the first snapshot.")
    process.exit(0)
  }
  setHead(previous.id)
  exportHead(checkout(previous.id))
  console.log(`HEAD ${current.id} -> ${previous.id} ("${previous.intent}")`)
  process.exit(0)
}
for (const s of history()) console.log(`${s.id}  ${s.createdAt}  ${s.author.padEnd(8)} ${s.intent}`)
process.exit(0)
