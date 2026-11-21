import { describe, expect, it } from "vitest"

import { onlyAddsScreens } from "@/lib/agent/orchestrator"
import type { AppPlan, PlanScreen } from "@app/shared/agent/types"

const design = {
  style: "Clean",
  primaryColor: "#1a4be0",
  accentColor: "#f59e0b",
  backgroundColor: "#f6f7f9",
  surfaceColor: "#ffffff",
  textColor: "#111111",
  cornerRadius: "soft" as const,
  typography: "System sans-serif",
}

function plan(screens: PlanScreen[]): AppPlan {
  return { appName: "App", summary: "", targetUsers: "", coreFeatures: [], design, navigation: "", screens }
}

function screen(over: Partial<PlanScreen>): PlanScreen {
  return { id: "x", name: "X", purpose: "p", keyElements: ["a"], navigatesTo: [], presentation: "stack", ...over }
}

describe("onlyAddsScreens", () => {
  it("is additive for a plain new screen that nothing else links to", () => {
    const prev = plan([screen({ id: "home", name: "Home" })])
    const next = plan([screen({ id: "home", name: "Home" }), screen({ id: "about", name: "About" })])
    expect(onlyAddsScreens(prev, next)).toBe(true)
  })

  it("is additive when an existing screen gains a link (and matching keyElements/purpose wording) to the new screen", () => {
    // The real case from production: "add a settings screen" reached via a gear
    // icon on the existing Tasks screen. Tasks' own keyElements/purpose/navigatesTo
    // legitimately change to describe the new link.
    const prev = plan([screen({ id: "tasks", name: "Tasks", keyElements: ["Task list"], navigatesTo: ["add-task"] })])
    const next = plan([
      screen({ id: "tasks", name: "Tasks", keyElements: ["Task list", "Gear icon to open Settings"], navigatesTo: ["add-task", "settings"] }),
      screen({ id: "settings", name: "Settings" }),
    ])
    expect(onlyAddsScreens(prev, next)).toBe(true)
  })

  it("is not additive when the screen count doesn't grow", () => {
    const prev = plan([screen({ id: "home" })])
    const next = plan([screen({ id: "home", name: "Renamed Home" })])
    expect(onlyAddsScreens(prev, next)).toBe(false)
  })

  it("is not additive when the design changes", () => {
    const prev = plan([screen({ id: "home" })])
    const next: AppPlan = { ...plan([screen({ id: "home" }), screen({ id: "about" })]), design: { ...design, primaryColor: "#000000" } }
    expect(onlyAddsScreens(prev, next)).toBe(false)
  })

  it("is not additive when an existing screen is renamed", () => {
    const prev = plan([screen({ id: "home", name: "Home" })])
    const next = plan([screen({ id: "home", name: "Dashboard" }), screen({ id: "about", name: "About" })])
    expect(onlyAddsScreens(prev, next)).toBe(false)
  })

  it("is not additive when an existing screen's presentation changes", () => {
    const prev = plan([screen({ id: "home", presentation: "stack" })])
    const next = plan([screen({ id: "home", presentation: "tab" }), screen({ id: "about" })])
    expect(onlyAddsScreens(prev, next)).toBe(false)
  })

  it("is not additive when an existing screen drops a link to a screen that already existed", () => {
    const prev = plan([screen({ id: "home", navigatesTo: ["profile"] }), screen({ id: "profile" })])
    const next = plan([screen({ id: "home", navigatesTo: [] }), screen({ id: "profile" }), screen({ id: "about" })])
    expect(onlyAddsScreens(prev, next)).toBe(false)
  })

  it("is not additive when an existing screen's link is replaced rather than added to", () => {
    const prev = plan([screen({ id: "home", navigatesTo: ["profile"] }), screen({ id: "profile" })])
    const next = plan([screen({ id: "home", navigatesTo: ["settings"] }), screen({ id: "profile" }), screen({ id: "settings" })])
    expect(onlyAddsScreens(prev, next)).toBe(false)
  })
})
