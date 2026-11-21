import { Agent, run as runAgent, type AgentInputItem } from "@openai/agents"

import { ROUTER_INSTRUCTIONS } from "@/lib/verify/router"
import { getFastModel, getModel, reasoningEffort, reasoningProviderData } from "./config"
import {
  EDIT_INSTRUCTIONS,
  FOUNDATION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  SHELL_INSTRUCTIONS,
} from "./prompts"
import type { LiveRun } from "./registry"

let planner: Agent | null = null
let planFixer: Agent | null = null
let foundation: Agent | null = null
let shell: Agent | null = null
let fixer: Agent | null = null
let router: Agent | null = null

export function getAgents() {
  const model = getModel()
  // Support work (themes + data, fixes, edits) can run on a faster model (AI_MODEL_FAST).
  const fast = getFastModel()
  // Hidden reasoning before the first visible token is the slowest part of a
  // call on reasoning models; keep it small (AI_REASONING_EFFORT).
  const reasoning = { effort: reasoningEffort() }
  const providerData = reasoningProviderData()
  // The gateway's default output cap is small enough to cut a file off
  // mid-way, so set explicit limits.
  planner ??= new Agent({ name: "Planner", instructions: PLANNER_INSTRUCTIONS, model, modelSettings: { maxTokens: 6000, reasoning, providerData } })
  shell ??= new Agent({ name: "App shell", instructions: SHELL_INSTRUCTIONS, model, modelSettings: { maxTokens: 24000, reasoning, providerData } })
  // Fixes return only the changed lines (search/replace blocks).
  fixer ??= new Agent({ name: "Code fixer", instructions: EDIT_INSTRUCTIONS, model: fast, modelSettings: { maxTokens: 16000, reasoning, providerData } })
  planFixer ??= new Agent({
    name: "Plan fixer",
    instructions:
      "You repair malformed JSON. Return only the corrected JSON object for the app plan you are given: valid JSON, same content, no prose, no code fences.",
    model: fast,
    modelSettings: { maxTokens: 6000, reasoning, providerData },
  })
  foundation ??= new Agent({ name: "Design system", instructions: FOUNDATION_INSTRUCTIONS, model: fast, modelSettings: { maxTokens: 12000, reasoning, providerData } })
  router ??= new Agent({ name: "Router", instructions: ROUTER_INSTRUCTIONS, model: fast, modelSettings: { maxTokens: 400, reasoning, providerData } })
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
      // The output budget ran out before any visible text: hidden reasoning
      // ate it. Sending the same request again fails the same way, so retry
      // with reasoning off and more room.
      if (/finish_reason='?length/i.test(msg)) {
        const s = current.modelSettings
        const pd = s.providerData && "reasoning" in s.providerData ? { ...s.providerData, reasoning: { enabled: false } } : s.providerData
        current = current.clone({
          modelSettings: { ...s, reasoning: { effort: "none" }, providerData: pd, maxTokens: Math.min(32_000, Math.round((s.maxTokens ?? 16_000) * 1.5)) },
        })
        onRetry?.(attempt)
        continue
      }
      onRetry?.(attempt)
      await sleep(1500 * attempt)
    }
  }
}
