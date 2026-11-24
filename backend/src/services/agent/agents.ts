import { Agent, run as runAgent, type AgentInputItem } from "@openai/agents"

import { ROUTER_INSTRUCTIONS } from "@/lib/verify/router"
import { classifyTool, editFileTool, stopAfterToolCalls, writeFileTool, type ToolCallLog } from "@/lib/verify/tools"
import { getFastModel, getModel, reasoningEffort, reasoningProviderData, toolCallingMode, type ToolCallingMode } from "./config"
import {
  EDIT_INSTRUCTIONS,
  FOUNDATION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  SHELL_INSTRUCTIONS,
} from "./prompts"
import type { LiveRun } from "./registry"
import { approveBuildTool, proposePlanTool, requestEditTool, setFoundationTool, submitFixTool } from "./tools"
import { ToolCallStreamAccumulator } from "./tool-call-stream"

let agentsByMode: Map<ToolCallingMode, ReturnType<typeof buildAgents>> | null = null

/**
 * One agent set per `toolCallingMode()` value, built once each (not per
 * mode change at runtime -- the env var is read once per process in
 * practice, but caching by mode rather than unconditionally keeps this
 * correct if a test or a hot reload changes it).
 */
export function getAgents() {
  agentsByMode ??= new Map()
  const mode = toolCallingMode()
  let agents = agentsByMode.get(mode)
  if (!agents) {
    agents = buildAgents(mode)
    agentsByMode.set(mode, agents)
  }
  return agents
}

function buildAgents(mode: ToolCallingMode) {
  const model = getModel()
  // Support work (themes + data, fixes, edits) can run on a faster model (AI_MODEL_FAST).
  const fast = getFastModel()
  // Hidden reasoning before the first visible token is the slowest part of a
  // call on reasoning models; keep it small (AI_REASONING_EFFORT).
  const reasoning = { effort: reasoningEffort() }
  const providerData = reasoningProviderData()
  // The gateway's default output cap is small enough to cut a file off
  // mid-way, so set explicit limits. Every agent here acts only through its
  // tools (never tagged text); toolUseBehavior stops the run as soon as the
  // first batch of tool calls comes back, since the caller's own logic (not
  // the SDK's tool loop) owns any follow-up. AI_TOOL_CALLING=off (see
  // config.ts's toolCallingMode) attaches no tools at all -- a manual kill
  // switch, not a polished fallback (the prompts only describe tool-calling).
  const withTools = <T extends object>(extra: T) => (mode === "off" ? {} : extra)
  const planner = new Agent({
    name: "Planner",
    instructions: PLANNER_INSTRUCTIONS,
    model,
    modelSettings: { maxTokens: 6000, reasoning, providerData },
    ...withTools({ tools: [proposePlanTool, requestEditTool, approveBuildTool], toolUseBehavior: stopAfterToolCalls }),
  })
  const shell = new Agent({
    name: "App shell",
    instructions: SHELL_INSTRUCTIONS,
    model,
    modelSettings: { maxTokens: 24000, reasoning, providerData },
    ...withTools({ tools: [writeFileTool], toolUseBehavior: stopAfterToolCalls }),
  })
  // Fixes return only the changed lines (edit_file hunks), or a whole file for a bigger fix.
  const fixer = new Agent({
    name: "Code fixer",
    instructions: EDIT_INSTRUCTIONS,
    model: fast,
    modelSettings: { maxTokens: 16000, reasoning, providerData },
    ...withTools({ tools: [writeFileTool, editFileTool], toolUseBehavior: stopAfterToolCalls }),
  })
  const planFixer = new Agent({
    name: "Plan fixer",
    instructions: "You repair a malformed app plan. Call submit_fix once with the corrected plan: same content, valid shape.",
    model: fast,
    modelSettings: { maxTokens: 6000, reasoning, providerData },
    ...withTools({ tools: [submitFixTool], toolUseBehavior: stopAfterToolCalls }),
  })
  const foundation = new Agent({
    name: "Design system",
    instructions: FOUNDATION_INSTRUCTIONS,
    model: fast,
    modelSettings: { maxTokens: 12000, reasoning, providerData },
    ...withTools({ tools: [setFoundationTool], toolUseBehavior: stopAfterToolCalls }),
  })
  const router = new Agent({
    name: "Router",
    instructions: ROUTER_INSTRUCTIONS,
    model: fast,
    modelSettings: { maxTokens: 400, reasoning, providerData },
    ...withTools({ tools: [classifyTool], toolUseBehavior: stopAfterToolCalls }),
  })
  return { planner, planFixer, foundation, shell, fixer, router }
}

/**
 * The gateway can go quiet for a long time before the first token. While
 * nothing arrives, keep the user informed with a status line. Unlike before,
 * this only emits when the label itself changes, not once a second: each
 * event carries a `since` timestamp so the client counts elapsed seconds
 * itself instead of being sent a new event every second for the same status.
 */
export function heartbeat(run: LiveRun, label: () => string) {
  let lastLabel: string | null = null
  const emitIfChanged = () => {
    const text = label()
    if (text === lastLabel) return
    lastLabel = text
    run.emit({ type: "status", text, since: Date.now() })
  }
  emitIfChanged()
  const timer = setInterval(emitIfChanged, 1000)
  return {
    touch: () => {},
    stop: () => clearInterval(timer),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_ATTEMPTS = 3

/**
 * The output budget ran out before any visible output: hidden reasoning ate
 * it. Sending the same request again fails the same way, so the retry needs
 * reasoning off and more room. Returns the agent to retry with, or `null`
 * when `msg` isn't that failure (the caller should fall back to a plain
 * delayed retry instead). Shared by every retry loop in this file.
 */
function retryWithMoreRoom(agent: Agent, msg: string): Agent | null {
  if (!/finish_reason='?length/i.test(msg)) return null
  const s = agent.modelSettings
  const pd = s.providerData && "reasoning" in s.providerData ? { ...s.providerData, reasoning: { enabled: false } } : s.providerData
  return agent.clone({ modelSettings: { ...s, reasoning: { effort: "none" }, providerData: pd, maxTokens: Math.min(32_000, Math.round((s.maxTokens ?? 16_000) * 1.5)) } })
}

/**
 * Streams one agent turn. Failures before the first token (the gateway
 * intermittently answers "model not found" or drops the request) are retried,
 * since nothing has reached the user yet; failures mid-stream are not.
 */
export async function streamText(
  agent: Agent,
  input: string | AgentInputItem[],
  onDelta: (delta: string) => void,
  onRetry?: (attempt: number) => void,
  /** Filled with the model's stop reason ("stop", "length"...). "length" means the output was cut off. */
  info?: { finishReason?: string }
): Promise<string> {
  let current = agent
  for (let attempt = 1; ; attempt++) {
    let text = ""
    try {
      const result = await runAgent(current, input, { stream: true, maxTurns: 1 })
      for await (const ev of result) {
        if (ev.type !== "raw_model_stream_event") continue
        if (ev.data.type === "output_text_delta") {
          text += ev.data.delta
          onDelta(ev.data.delta)
        } else if (ev.data.type === "model" && info) {
          const reason = (ev.data.event as { choices?: { finish_reason?: string | null }[] })?.choices?.[0]?.finish_reason
          if (reason) info.finishReason = reason
        }
      }
      await result.completed
      if (result.error) throw result.error
      // Some providers only deliver the final text.
      if (!text && typeof result.finalOutput === "string") {
        text = result.finalOutput
        onDelta(text)
      }
      return text
    } catch (e) {
      if (text || attempt >= MAX_ATTEMPTS) throw e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`agent call failed before output (attempt ${attempt}), retrying`, msg)
      const retryAgent = retryWithMoreRoom(current, msg)
      if (retryAgent) {
        current = retryAgent
        onRetry?.(attempt)
        continue
      }
      onRetry?.(attempt)
      await sleep(1500 * attempt)
    }
  }
}

/**
 * Calls an agent that acts only through tool calls (no streaming, no live
 * UX): router, foundation, planFixer, shell, fixer. `toolCalls` is whatever
 * each tool's inert `execute` recorded (see lib/verify/tools.ts), via the
 * `context` array passed as the run's context.
 */
export async function runWithTools(agent: Agent, input: string | AgentInputItem[], onRetry?: (attempt: number) => void): Promise<{ text: string; toolCalls: ToolCallLog }> {
  let current = agent
  for (let attempt = 1; ; attempt++) {
    const context: ToolCallLog = []
    try {
      const result = await runAgent(current, input, { maxTurns: 1, context })
      const text = typeof result.finalOutput === "string" ? result.finalOutput : ""
      return { text, toolCalls: context }
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS) throw e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`agent call failed (attempt ${attempt}), retrying`, msg)
      const retryAgent = retryWithMoreRoom(current, msg)
      if (retryAgent) {
        current = retryAgent
        onRetry?.(attempt)
        continue
      }
      onRetry?.(attempt)
      await sleep(1500 * attempt)
    }
  }
}

/**
 * Streams one agent turn that may also call a tool in the same reply (the
 * planner's shape: visible prose plus propose_plan/request_edit/
 * approve_build). Prose streams exactly as `streamText` does (the SDK's
 * `output_text_delta` events are unaffected by tools being attached --
 * confirmed in the live probe, docs/tool-calling plan Phase 1). Tool calls
 * are rebuilt from the raw chunks ourselves (`ToolCallStreamAccumulator`),
 * not from the SDK's own post-stream tool invocation, which the same probe
 * found corrupts a tool's name when this gateway is involved -- so a
 * `result.error` at the end is expected and swallowed once our own
 * accumulator already has something, rather than treated as a failure.
 */
export async function streamTextWithTools(
  agent: Agent,
  input: string | AgentInputItem[],
  onDelta: (delta: string) => void,
  onRetry?: (attempt: number) => void,
  /** Called with the growing, still-partial JSON text of the first tool call's arguments as it streams in (for a live-progress UI; the full call only lands in `toolCalls` once the reply completes). */
  onToolArgsDelta?: (partialJson: string) => void
): Promise<{ text: string; toolCalls: ToolCallLog }> {
  let current = agent
  for (let attempt = 1; ; attempt++) {
    let text = ""
    const acc = new ToolCallStreamAccumulator()
    try {
      const result = await runAgent(current, input, { stream: true, maxTurns: 1 })
      for await (const ev of result) {
        if (ev.type !== "raw_model_stream_event") continue
        if (ev.data.type === "output_text_delta") {
          text += ev.data.delta
          onDelta(ev.data.delta)
        } else if (ev.data.type === "model") {
          acc.push(ev.data.event)
          onToolArgsDelta?.(acc.partialArgsJson(0))
        }
      }
      await result.completed
      if (result.error) throw result.error
      if (!text && !acc.size && typeof result.finalOutput === "string") {
        text = result.finalOutput
        onDelta(text)
      }
      return { text, toolCalls: acc.toToolCallLog() }
    } catch (e) {
      // A tool-calling reply makes the SDK throw while reassembling the
      // response -- confirmed live (docs/tool-calling plan Phase 1): the
      // gateway resends a tool's full name on every chunk instead of once,
      // which corrupts @openai/agents-openai's own accumulator, and the
      // resulting "Tool ... not found" throw can come from inside the
      // `for await` loop itself, not only from `result.completed`. Our own
      // raw-chunk accumulator already has everything it needs by the time
      // this happens, so once it has at least one call, this is not a
      // real failure.
      if (acc.size) return { text, toolCalls: acc.toToolCallLog() }
      if (text || attempt >= MAX_ATTEMPTS) throw e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`agent call failed before output (attempt ${attempt}), retrying`, msg)
      const retryAgent = retryWithMoreRoom(current, msg)
      if (retryAgent) {
        current = retryAgent
        onRetry?.(attempt)
        continue
      }
      onRetry?.(attempt)
      await sleep(1500 * attempt)
    }
  }
}
