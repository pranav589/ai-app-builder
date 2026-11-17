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

/** Calls the coder model once. One retry on a transient failure before any output arrived. */
export const coderAdapter: ModelAdapter = async (turns) => {
  const t0 = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await runAgent(agent(), toInput(turns), { maxTurns: 1 })
      const text = typeof result.finalOutput === "string" ? result.finalOutput : ""
      const usage = result.rawResponses.at(-1)?.usage
      return { text, modelMs: Date.now() - t0, tokens: usage ? { prompt: usage.inputTokens, completion: usage.outputTokens } : undefined }
    } catch (e) {
      if (attempt >= 3) throw e
      console.warn(`verified coder call failed (attempt ${attempt}), retrying`, e instanceof Error ? e.message : e)
      await sleep(1000 * attempt)
    }
  }
}
