import { Agent, assistant, run as runAgent, user } from "@openai/agents"

import { getCoderModel, reasoningEffort, reasoningProviderData, toolCallingMode, type ToolCallingMode } from "@/lib/agent/config"
import { VERIFIED_CODER_INSTRUCTIONS } from "./prompts"
import type { ModelAdapter, Turn } from "./run"
import { CODER_TOOLS, stopAfterToolCalls, type ToolCallLog } from "./tools"

const agentsByMode = new Map<ToolCallingMode, Agent>()

/** AI_TOOL_CALLING=off (config.ts's toolCallingMode) is a manual kill switch: no tools attached at all. */
function agent() {
  const mode = toolCallingMode()
  let coder = agentsByMode.get(mode)
  if (!coder) {
    coder = new Agent({
      name: "Verified coder",
      instructions: VERIFIED_CODER_INSTRUCTIONS,
      model: getCoderModel(),
      modelSettings: { maxTokens: 12_000, reasoning: { effort: reasoningEffort() }, providerData: reasoningProviderData() },
      ...(mode === "off" ? {} : { tools: CODER_TOOLS, toolUseBehavior: stopAfterToolCalls }),
    })
    agentsByMode.set(mode, coder)
  }
  return coder
}

const toInput = (turns: Turn[]) => turns.map((t) => (t.role === "user" ? user(t.content) : assistant(t.content)))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Calls the coder model once, non-streaming: tool calls always come back
 * correctly from the SDK this way (confirmed live, docs/tool-calling plan
 * Phase 1 -- streaming tool calls hit a gateway/SDK bug this path avoids
 * entirely). One retry on a transient failure before any output arrived.
 * With `onDelta`, reveals each written/edited file's content once the whole
 * reply has arrived (not character by character -- the per-file completion
 * progress the live-typing UX moved to, since tool-call arguments don't
 * stream as readable code anyway); without it, the caller just gets the
 * final `ModelReply`.
 */
export const coderAdapter: ModelAdapter = async (turns, onDelta) => {
  const t0 = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      const context: ToolCallLog = []
      const result = await runAgent(agent(), toInput(turns), { maxTurns: 1, context })
      const text = typeof result.finalOutput === "string" ? result.finalOutput : ""
      if (onDelta) {
        for (const call of context) {
          if (call.name === "write_file") onDelta((call.args as { content: string }).content)
        }
      }
      const usage = result.rawResponses.at(-1)?.usage
      return { text, toolCalls: context, modelMs: Date.now() - t0, tokens: usage ? { prompt: usage.inputTokens, completion: usage.outputTokens } : undefined }
    } catch (e) {
      if (attempt >= 3) throw e
      console.warn(`verified coder call failed (attempt ${attempt}), retrying`, e instanceof Error ? e.message : e)
      await sleep(1000 * attempt)
    }
  }
}
