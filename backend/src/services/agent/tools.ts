// Real tool-calling for the planner, planFixer and foundation agents --
// the plan-building side, as opposed to lib/verify/tools.ts's file-mutation
// tools for the coder/router/shell/fixer. Same inert-accumulator pattern
// (see that file's header comment): execute() only records the call, never
// acts on it.

import { z } from "zod"
import { tool } from "@openai/agents"

import { record, type ToolCallLog } from "@/lib/verify/tools"
import { normalizePlan, type EditRequest } from "./protocol"
import type { AppPlan } from "@app/shared/agent/types"

/**
 * The shape advertised to the model for a plan. This mirrors `planSchema`
 * (protocol.ts) field-for-field, but without its `.catch()`/`.transform()`
 * leniency: the SDK converts a tool's `parameters` to a JSON Schema sent to
 * the model, and transforms aren't representable in JSON Schema ("Transforms
 * cannot be represented in JSON Schema" -- confirmed by trying to reuse
 * `planSchema` directly here, which the SDK rejected at tool-definition time).
 * The actual lenient validation still lives only in `planSchema`/
 * `normalizePlan` -- this schema only declares the contract; every tool call
 * is re-validated through `normalizePlan` below, exactly like the tagged
 * `<plan>` block's raw JSON is today.
 */
const planInputSchema = z.object({
  appName: z.string().min(1).max(60),
  summary: z.string().optional(),
  targetUsers: z.string().optional(),
  coreFeatures: z.array(z.string()).optional(),
  design: z
    .object({
      style: z.string().optional(),
      primaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      backgroundColor: z.string().optional(),
      surfaceColor: z.string().optional(),
      textColor: z.string().optional(),
      cornerRadius: z.enum(["sharp", "soft", "round"]).optional(),
      typography: z.string().optional(),
    })
    .optional(),
  navigation: z.string().optional(),
  screens: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(60),
        purpose: z.string().optional(),
        keyElements: z.array(z.string()).optional(),
        navigatesTo: z.array(z.string()).optional(),
        presentation: z.enum(["tab", "stack", "modal"]).optional(),
      })
    )
    .min(1),
})

/** Reused by both the planner (propose a plan) and the planFixer (submit a corrected plan). */
export const proposePlanParams = z.object({ plan: planInputSchema })
export const proposePlanTool = tool({
  name: "propose_plan",
  description: "Propose or revise the app's plan: name, screens, design direction, data model summary.",
  parameters: proposePlanParams,
  execute: record("propose_plan"),
})

export const submitFixParams = z.object({ plan: planInputSchema })
export const submitFixTool = tool({
  name: "submit_fix",
  description: "Submit the corrected app plan, same shape as propose_plan, fixing whatever was malformed.",
  parameters: submitFixParams,
  execute: record("submit_fix"),
})

export const requestEditParams = z.object({ targets: z.array(z.string()).describe("Screen ids and/or file paths to change."), instruction: z.string() })
export const requestEditTool = tool({
  name: "request_edit",
  description: "Apply a change to screens or components that already exist, without changing the plan or rebuilding the app.",
  parameters: requestEditParams,
  execute: record("request_edit"),
})

export const approveBuildParams = z.object({})
export const approveBuildTool = tool({
  name: "approve_build",
  description: "Call this when the user has clearly approved the current plan and building should start.",
  parameters: approveBuildParams,
  execute: record("approve_build"),
})

/** The planner's full tool set. */
export const PLANNER_TOOLS = [proposePlanTool, requestEditTool, approveBuildTool]

export function toolCallsToPlannerReply(log: ToolCallLog): { plan: AppPlan | null; planInvalid: boolean; approved: boolean; edit: EditRequest | null } {
  const planCall = log.find((c) => c.name === "propose_plan")
  const editCall = log.find((c) => c.name === "request_edit")
  const approveCall = log.find((c) => c.name === "approve_build")
  if (planCall) {
    const plan = normalizePlan((planCall.args as { plan: unknown }).plan)
    return { plan, planInvalid: !plan, approved: !!approveCall, edit: null }
  }
  if (editCall) {
    const a = editCall.args as EditRequest
    return { plan: null, planInvalid: false, approved: !!approveCall, edit: { targets: a.targets, instruction: a.instruction } }
  }
  return { plan: null, planInvalid: false, approved: !!approveCall, edit: null }
}

export function toolCallsToFixedPlan(log: ToolCallLog): AppPlan | null {
  const call = log.find((c) => c.name === "submit_fix")
  if (!call) return null
  return normalizePlan((call.args as { plan: unknown }).plan)
}

/**
 * The foundation step's reply is already "ONLY a JSON object, no prose" --
 * the easiest conversion in this plan. `themes`/`motion`/`data` stay
 * `z.unknown()` deliberately: the existing normalizers (normalizeThemes,
 * asMotionLevel, normalizeDataModel) already accept and sanitize raw,
 * possibly-imperfect input with fallbacks, so a stricter tool schema here
 * would only reject output the current loose-JSON path already tolerates.
 */
export const setFoundationParams = z.object({ themes: z.unknown(), motion: z.unknown().optional(), data: z.unknown() })
export const setFoundationTool = tool({
  name: "set_foundation",
  description: "Set the app's theme package, motion level and data model. Reply with ONLY this call.",
  parameters: setFoundationParams,
  execute: record("set_foundation"),
})

export function toolCallsToFoundation(log: ToolCallLog): { themes?: unknown; motion?: unknown; data?: unknown } | null {
  const call = log.find((c) => c.name === "set_foundation")
  if (!call) return null
  return call.args as { themes?: unknown; motion?: unknown; data?: unknown }
}
