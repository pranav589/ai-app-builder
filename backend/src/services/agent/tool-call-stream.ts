// Rebuilds tool calls from raw OpenAI chat-completions stream chunks,
// working around a confirmed gateway/SDK bug (docs/tool-calling plan, Phase
// 1's live probe): the gateway resends the complete `function.name` on every
// delta chunk for a tool call, not just the first as the OpenAI streaming
// spec expects. `@openai/agents-openai`'s own accumulator treats `name` as
// an incremental string and concatenates every chunk, producing a corrupted
// name ("write_filewrite_file...") and then throwing "Tool ... not found in
// agent" once the stream ends. Taking `name` only the first time it's seen
// for a given tool-call index -- and ignoring it on every later chunk for
// that index -- reconstructs the call correctly; proven in the probe script
// (scripts/probe-tool-calling.ts) against the real gateway.
//
// Only needed for streaming. Non-streaming tool calls already come back
// correctly from the SDK (confirmed in the same probe) and don't need this.

import type { ToolCallLog } from "@/lib/verify/tools"

type RawDeltaToolCall = { index: number; function?: { name?: string; arguments?: string } }
type RawDelta = { content?: string; tool_calls?: RawDeltaToolCall[] }
type RawChunk = { choices?: { delta?: RawDelta }[] }

export class ToolCallStreamAccumulator {
  private byIndex = new Map<number, { name: string; argsJson: string }>()

  /** Feed one raw chat-completions chunk (`ev.data.event` from a `raw_model_stream_event` with `data.type === "model"`). */
  push(chunk: unknown) {
    const toolCalls = (chunk as RawChunk)?.choices?.[0]?.delta?.tool_calls
    for (const tc of toolCalls ?? []) {
      const entry = this.byIndex.get(tc.index) ?? { name: "", argsJson: "" }
      if (!entry.name && tc.function?.name) entry.name = tc.function.name
      if (tc.function?.arguments) entry.argsJson += tc.function.arguments
      this.byIndex.set(tc.index, entry)
    }
  }

  /** The raw, still-growing JSON text for the tool call at `index` (for live progress UIs, e.g. partial screen names mid-stream). */
  partialArgsJson(index = 0): string {
    return this.byIndex.get(index)?.argsJson ?? ""
  }

  get size() {
    return this.byIndex.size
  }

  /** Finished calls, in index order, with arguments parsed as JSON (dropped if malformed). */
  toToolCallLog(): ToolCallLog {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => {
        try {
          return { name: c.name, args: JSON.parse(c.argsJson) }
        } catch {
          return null
        }
      })
      .filter((c): c is ToolCallLog[number] => c !== null)
  }
}
