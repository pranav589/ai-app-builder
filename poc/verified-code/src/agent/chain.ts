import { isFatalProviderError } from "./model"
import { runChange, type RunReport } from "./run"
import { appFiles, loadFixture, type Workspace } from "../core/workspace"

// Ten changes applied one after another, each on top of the previous verified app, the
// way a real user builds. Shared by the `chain` CLI (reports numbers) and the `export-expo`
// CLI (needs a grown, real app to put on a device).

export const CHAIN_STEPS = [
  "Add a Streaks tab that shows, for each habit, the number of check-ins as a large stat and a progress bar toward its weekly target.",
  "On the habit detail screen, add a 'Check in today' button that creates an Entry for this habit with today's date (YYYY-MM-DD), disabled if there is already an entry for today.",
  "Add categories: a Category entity with a name and a few seed categories, let habits optionally belong to a category, and show category filter badges on the home screen.",
  "Add a search field at the top of the home screen that filters habits by title as you type, with an empty state when nothing matches.",
  "Let users edit a habit: an Edit button on the detail screen opens an edit screen with the title, target and category prefilled.",
  "Add a journal: a JournalEntry entity with text and date, a Journal tab listing entries newest first, and a modal screen to write a new entry.",
  "Add an Achievements screen, opened from the Profile tab, listing 'First check-in', '10 check-ins' and 'Perfect week' badges, unearned ones muted.",
  "Extract the habit card used on the home screen into a reusable component in components/home/HabitCard.tsx and use it on the Streaks tab too.",
  "Add a weekly bar chart to the Profile tab showing check-ins per day for the last 7 days, built from Views with heights proportional to counts.",
  "Add a Settings screen opened from the Profile tab with 'Daily reminder' and 'Weekly summary' toggles stored in a new Setting entity.",
]

export const chainSize = (w: Workspace) => {
  const files = appFiles(w)
  return { files: Object.keys(files).length, lines: Object.values(files).reduce((s, c) => s + c.split("\n").length, 0), screens: Object.keys(w.manifest.screens).length }
}

export type ChainStepResult = { n: number; request: string; report?: RunReport; stopped?: string }

/** Runs CHAIN_STEPS against `start` (default: the base fixture), one after another. */
export async function runChainSteps(opts: {
  model: string
  context: "all" | "focused"
  start?: Workspace
  onStep?: (r: ChainStepResult, ws: Workspace) => void
}): Promise<{ ws: Workspace; steps: ChainStepResult[] }> {
  let ws = opts.start ?? loadFixture()
  const steps: ChainStepResult[] = []
  for (const [i, request] of CHAIN_STEPS.entries()) {
    const n = i + 1
    let report: RunReport
    try {
      report = await runChange(ws, request, { model: opts.model, context: opts.context })
    } catch (e) {
      const stopped = e instanceof Error ? e.message : String(e)
      const r = { n, request, stopped }
      steps.push(r)
      opts.onStep?.(r, ws)
      if (isFatalProviderError(e)) break
      continue
    }
    if (report.state === "committed" && report.ws) ws = report.ws
    const r = { n, request, report }
    steps.push(r)
    opts.onStep?.(r, ws)
  }
  return { ws, steps }
}
