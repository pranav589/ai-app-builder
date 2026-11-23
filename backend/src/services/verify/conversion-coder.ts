import { Agent, assistant, run as runAgent, user } from "@openai/agents"

import { getFastModel, reasoningEffort, reasoningProviderData } from "@/lib/agent/config"
import { CONVERSION_INSTRUCTIONS } from "./conversion-prompts"
import type { ModelAdapter, Turn } from "./run"

// A separate Agent from the verified coder's (coder.ts): the backend
// conversion needs a much narrower system prompt (CONVERSION_INSTRUCTIONS),
// and is a mechanical, well-specified rewrite -- the fast model is enough,
// the same choice the backend-setup agent (cloudhike/provision.ts) makes.

let conversionCoder: Agent | null = null

function agent() {
  conversionCoder ??= new Agent({
    name: "Backend conversion coder",
    instructions: CONVERSION_INSTRUCTIONS,
    model: getFastModel(),
    modelSettings: { maxTokens: 12_000, reasoning: { effort: reasoningEffort() }, providerData: reasoningProviderData() },
  })
  return conversionCoder
}

const toInput = (turns: Turn[]) => turns.map((t) => (t.role === "user" ? user(t.content) : assistant(t.content)))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Same shape as verify/coder.ts's coderAdapter, non-streaming only: this runs server-side between the connect/disconnect flow and the next chat message, not live in front of the creator. */
export const conversionCoderAdapter: ModelAdapter = async (turns) => {
  const t0 = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await runAgent(agent(), toInput(turns), { maxTurns: 1 })
      const text = typeof result.finalOutput === "string" ? result.finalOutput : ""
      const usage = result.rawResponses.at(-1)?.usage
      return { text, modelMs: Date.now() - t0, tokens: usage ? { prompt: usage.inputTokens, completion: usage.outputTokens } : undefined }
    } catch (e) {
      if (attempt >= 3) throw e
      console.warn(`backend conversion coder call failed (attempt ${attempt}), retrying`, e instanceof Error ? e.message : e)
      await sleep(1000 * attempt)
    }
  }
}
