import { describe, expect, it } from "vitest"
import {
  approveBuildParams,
  proposePlanParams,
  requestEditParams,
  setFoundationParams,
  submitFixParams,
  toolCallsToFixedPlan,
  toolCallsToFoundation,
  toolCallsToPlannerReply,
} from "@/lib/agent/tools"
import type { ToolCallLog } from "@/lib/verify/tools"
import { normalizePlan, parseEditTag, parseFoundationJson, parsePlanJson, parsePlannerReply } from "@/lib/agent/protocol"

const rawPlan = {
  appName: "Habit Tracker",
  summary: "Track daily habits",
  targetUsers: "Everyone",
  coreFeatures: ["Streaks"],
  design: { style: "Clean" },
  navigation: "Tabs",
  screens: [{ name: "Home", presentation: "tab" }],
}

describe("tool parameter schemas", () => {
  it("propose_plan and submit_fix reuse planSchema's lenient validation", () => {
    expect(proposePlanParams.parse({ plan: rawPlan }).plan.appName).toBe("Habit Tracker")
    expect(submitFixParams.parse({ plan: rawPlan }).plan.appName).toBe("Habit Tracker")
    expect(() => proposePlanParams.parse({ plan: { summary: "no appName" } })).toThrow()
  })

  it("request_edit requires an instruction", () => {
    expect(() => requestEditParams.parse({ targets: ["home"] })).toThrow()
    expect(requestEditParams.parse({ targets: ["home"], instruction: "Make it bigger." })).toEqual({ targets: ["home"], instruction: "Make it bigger." })
  })

  it("approve_build takes no arguments", () => {
    expect(approveBuildParams.parse({})).toEqual({})
  })

  it("set_foundation accepts arbitrary themes/motion/data shapes (normalizers do the sanitizing downstream)", () => {
    expect(setFoundationParams.parse({ themes: { anything: true }, data: [] })).toEqual({ themes: { anything: true }, data: [] })
  })
})

describe("toolCallsToPlannerReply", () => {
  it("maps a propose_plan call to the same shape parsePlannerReply's <plan> tag produces", () => {
    const log: ToolCallLog = [{ name: "propose_plan", args: { plan: rawPlan } }]
    const fromTool = toolCallsToPlannerReply(log)
    const fromTag = parsePlannerReply(`<plan>${JSON.stringify(rawPlan)}</plan>`)
    expect(fromTool.plan).toEqual(fromTag.plan)
    expect(fromTool.edit).toBeNull()
  })

  it("gives every screen a unique stable id, same as normalizePlan", () => {
    const dup = { ...rawPlan, screens: [{ name: "Home" }, { name: "Home" }] }
    const fromTool = toolCallsToPlannerReply([{ name: "propose_plan", args: { plan: dup } }])
    expect(fromTool.plan?.screens.map((s) => s.id)).toEqual(normalizePlan(dup)!.screens.map((s) => s.id))
  })

  it("maps a request_edit call to the same shape parseEditTag's <edit> tag produces", () => {
    const log: ToolCallLog = [{ name: "request_edit", args: { targets: ["home", "about"], instruction: "Make the header bigger." } }]
    const fromTool = toolCallsToPlannerReply(log)
    const fromTag = parseEditTag(`<edit targets="home,about">Make the header bigger.</edit>`)
    expect(fromTool.edit).toEqual(fromTag)
    expect(fromTool.plan).toBeNull()
  })

  it("reports approved only when approve_build was called", () => {
    expect(toolCallsToPlannerReply([{ name: "approve_build", args: {} }]).approved).toBe(true)
    expect(toolCallsToPlannerReply([]).approved).toBe(false)
  })
})

describe("toolCallsToFixedPlan", () => {
  it("maps a submit_fix call to the same plan parsePlanJson produces", () => {
    const fromTool = toolCallsToFixedPlan([{ name: "submit_fix", args: { plan: rawPlan } }])
    const fromJson = parsePlanJson(JSON.stringify(rawPlan))
    expect(fromTool).toEqual(fromJson)
  })

  it("returns null without a submit_fix call", () => {
    expect(toolCallsToFixedPlan([])).toBeNull()
  })
})

describe("toolCallsToFoundation", () => {
  it("maps a set_foundation call to the same shape parseFoundationJson produces", () => {
    const args = { themes: { x: 1 }, motion: "expressive", data: { collections: [] } }
    const fromTool = toolCallsToFoundation([{ name: "set_foundation", args }])
    const fromJson = parseFoundationJson(JSON.stringify(args))
    expect(fromTool).toEqual(fromJson)
  })

  it("returns null without a set_foundation call", () => {
    expect(toolCallsToFoundation([])).toBeNull()
  })
})
