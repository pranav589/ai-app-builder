import { describe, expect, it } from "vitest"

import { historyToInput } from "@/lib/agent/orchestrator"
import type { AppPlan, GeneratedScreen } from "@app/shared/agent/types"
import type { Project } from "@/db"

type DbMessage = Parameters<typeof historyToInput>[1][number]

const project = { name: "Habit Tracker", assets: [] } as unknown as Project

const plan: AppPlan = {
  appName: "Habit Tracker",
  summary: "Track daily habits",
  targetUsers: "Everyone",
  coreFeatures: ["Streaks"],
  design: {
    style: "Clean",
    primaryColor: "#1a4be0",
    accentColor: "#f59e0b",
    backgroundColor: "#f6f7f9",
    surfaceColor: "#ffffff",
    textColor: "#111111",
    cornerRadius: "soft",
    typography: "System sans-serif",
  },
  navigation: "Tabs",
  screens: [
    { id: "home", name: "Home", purpose: "See today's habits", keyElements: ["Streak counter", "Habit list"], navigatesTo: ["add-habit"], presentation: "tab" },
    { id: "settings", name: "Settings", purpose: "Tweak reminders", keyElements: ["Reminder time"], navigatesTo: [], presentation: "tab" },
  ],
}

const builtScreens: GeneratedScreen[] = plan.screens.map((s) => ({ id: s.id, name: s.name, state: "ready" }))

/** Many old rounds of chat, standing in for history long enough to push the original <plan> message out of the last-40 slice. */
function oldFiller(n: number): DbMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `old-${i}`,
    sender: "user",
    text: `old message ${i}`,
    type: "standard",
    plan: null,
    pipelineData: null,
  })) as DbMessage[]
}

describe("historyToInput", () => {
  it("includes the current plan verbatim even when no <plan> message is in the given history", () => {
    // Simulates runPlanning after the message carrying <plan> has scrolled out
    // of the last-40-message window: `history` here has no plan message at all.
    const history = oldFiller(5)
    const items = historyToInput(project, history, builtScreens, [], plan)
    const system = items[0] as { content: string }
    expect(system.content).toContain(JSON.stringify(plan))
    expect(system.content).toContain("Home")
    expect(system.content).toContain("See today's habits")
  })

  it("omits the plan block entirely when no plan is passed", () => {
    const items = historyToInput(project, [], builtScreens, [], null)
    const system = items[0] as { content: string }
    expect(system.content).not.toContain("</plan>")
  })

  it("still lists only built screen names, independent of the full plan block", () => {
    const items = historyToInput(project, [], builtScreens, [], plan)
    const system = items[0] as { content: string }
    expect(system.content).toContain("home: Home")
    expect(system.content).toContain("settings: Settings")
  })
})
