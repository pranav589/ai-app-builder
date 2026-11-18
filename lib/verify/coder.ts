import "server-only"
import { Agent, assistant, run as runAgent, user } from "@openai/agents"

import { getCoderModel, reasoningEffort, reasoningProviderData } from "@/lib/agent/config"
import { VERIFIED_CODER_INSTRUCTIONS } from "./prompts"
import type { ModelAdapter, Turn } from "./run"

let coder: Agent | null = null

function agent() {
  coder ??= new Agent({
    name: "Verified coder",
    instructions: VERIFIED_CODER_INSTRUCTIONS,
    model: getCoderModel(),
    modelSettings: { maxTokens: 12_000, reasoning: { effort: reasoningEffort() }, providerData: reasoningProviderData() },
  })
  return coder
}

const toInput = (turns: Turn[]) => turns.map((t) => (t.role === "user" ? user(t.content) : assistant(t.content)))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Calls the coder model once. One retry on a transient failure before any
 * output arrived. With `onDelta`, streams the reply (so a caller can show it
 * typing live, e.g. a new screen's code) instead of waiting for the whole
 * reply; without it, runs non-streaming.
 */
export const coderAdapter: ModelAdapter = async (turns, onDelta) => {
  const t0 = Date.now()
  for (let attempt = 1; ; attempt++) {
    let text = ""
    try {
      if (!onDelta) {
        const result = await runAgent(agent(), toInput(turns), { maxTurns: 1 })
        text = typeof result.finalOutput === "string" ? result.finalOutput : ""
        const usage = result.rawResponses.at(-1)?.usage
        return { text, modelMs: Date.now() - t0, tokens: usage ? { prompt: usage.inputTokens, completion: usage.outputTokens } : undefined }
      }
      const result = await runAgent(agent(), toInput(turns), { stream: true, maxTurns: 1 })
      for await (const ev of result) {
        if (ev.type === "raw_model_stream_event" && ev.data.type === "output_text_delta") {
          text += ev.data.delta
          onDelta(ev.data.delta)
        }
      }
      await result.completed
      if (result.error) throw result.error
      if (!text && typeof result.finalOutput === "string") {
        text = result.finalOutput
        onDelta(text)
      }
      const usage = result.rawResponses.at(-1)?.usage
      return { text, modelMs: Date.now() - t0, tokens: usage ? { prompt: usage.inputTokens, completion: usage.outputTokens } : undefined }
    } catch (e) {
      if (text || attempt >= 3) throw e
      console.warn(`verified coder call failed (attempt ${attempt}), retrying`, e instanceof Error ? e.message : e)
      await sleep(1000 * attempt)
    }
  }
}
