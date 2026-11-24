// Phase 1 of docs/tool-calling: a throwaway, live-key-only probe. Proves (or
// disproves) that AI_BASE_URL actually returns real tool_calls through the
// @openai/agents SDK this repo already depends on, for both model roles in
// play (getFastModel / getCoderModel) and both call shapes (non-streaming and
// streaming), plus the planner's specific need: prose content AND a tool call
// in the same turn, and multiple tool calls in one turn.
//
// Usage: node --env-file=.env --import tsx scripts/probe-tool-calling.ts
//
// Writes nothing to disk and calls no production code path — this only
// proves the SDK/gateway combination works before Phase 2/3 build on it.

import { z } from "zod"
import { Agent, run as runAgent, tool } from "@openai/agents"

import { getCoderModel, getFastModel } from "@/lib/agent/config"

type RawEvent = { type: string; data?: { type?: string; event?: unknown; delta?: string } }

function logLine(label: string, obj: unknown) {
  console.log(`  [${label}]`, typeof obj === "string" ? obj : JSON.stringify(obj))
}

const writeFileTool = tool({
  name: "write_file",
  description: "Record that a file should be written.",
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async (input) => {
    logLine("tool.execute write_file", input)
    return "queued"
  },
})

const sayTool = tool({
  name: "say",
  description: "Record a short status word.",
  parameters: z.object({ word: z.string() }),
  execute: async (input) => {
    logLine("tool.execute say", input)
    return "ok"
  },
})

// Stops the run after the first batch of tool calls instead of feeding their
// output back for another LLM turn (the SDK's "run_llm_again" default, which
// needs maxTurns >= 2 and is not what a ChangeSet-building tool call needs).
const stopAfterTools = () => ({ isFinalOutput: true as const, isInterrupted: undefined, finalOutput: "ok" })

async function nonStreamingProbe(roleName: string, model: ReturnType<typeof getFastModel>) {
  console.log(`\n--- [${roleName}] non-streaming, single tool call ---`)
  const agent = new Agent({
    name: "Probe",
    instructions: "When asked to write a file, call write_file. Do not reply with any other text.",
    model,
    tools: [writeFileTool],
    toolUseBehavior: stopAfterTools,
  })
  try {
    const result = await runAgent(agent, "Call write_file with path=\"probe.txt\" and content=\"hello\".", { maxTurns: 1 })
    logLine("finalOutput", result.finalOutput)
    logLine("output (raw items)", result.output)
    const lastResponse = result.rawResponses.at(-1)
    logLine("rawResponse finish_reason / choices", lastResponse)
  } catch (e) {
    logLine("ERROR", e instanceof Error ? e.message : e)
  }
}

async function streamingProbe(roleName: string, model: ReturnType<typeof getFastModel>) {
  console.log(`\n--- [${roleName}] streaming, single tool call ---`)
  const agent = new Agent({
    name: "Probe",
    instructions: "When asked to write a file, call write_file. Do not reply with any other text.",
    model,
    tools: [writeFileTool],
  })
  // Manually re-accumulate from raw chunks, taking `name` only on the first
  // chunk seen for each tool-call index (per the OpenAI streaming spec) and
  // ignoring it on later chunks for that index, to check whether the
  // corruption is purely the SDK's accumulator being fooled by a gateway that
  // resends the full name every chunk (a workaround), vs. something deeper.
  const byIndex = new Map<number, { name: string; args: string }>()
  try {
    const result = await runAgent(agent, "Call write_file with path=\"probe.txt\" and content=\"hello\".", { stream: true, maxTurns: 1 })
    for await (const ev of result as AsyncIterable<RawEvent>) {
      if (ev.type === "raw_model_stream_event") {
        if (ev.data?.type === "output_text_delta") {
          logLine("raw_model_stream_event output_text_delta", ev.data.delta)
        } else {
          logLine(`raw_model_stream_event ${ev.data?.type}`, ev.data?.event)
          const chunk = ev.data?.event as { choices?: { delta?: { tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[] } }[] } | undefined
          for (const tc of chunk?.choices?.[0]?.delta?.tool_calls ?? []) {
            const entry = byIndex.get(tc.index) ?? { name: "", args: "" }
            if (!entry.name && tc.function?.name) entry.name = tc.function.name
            if (tc.function?.arguments) entry.args += tc.function.arguments
            byIndex.set(tc.index, entry)
          }
        }
      } else {
        logLine(`event ${ev.type}`, ev)
      }
    }
    await result.completed
    if (result.error) throw result.error
    logLine("finalOutput", result.finalOutput)
    logLine("output (raw items)", result.output)
  } catch (e) {
    logLine("ERROR (SDK's own accumulation)", e instanceof Error ? e.message : e)
  }
  console.log("  -> manual re-accumulation from raw chunks:", JSON.stringify([...byIndex.values()]))
}

async function multiToolCallProbe(roleName: string, model: ReturnType<typeof getFastModel>) {
  console.log(`\n--- [${roleName}] non-streaming, TWO tool calls in one turn ---`)
  const agent = new Agent({
    name: "Probe",
    instructions: "Call write_file exactly twice, once for \"a.txt\" with content \"A\" and once for \"b.txt\" with content \"B\". Do not reply with any other text.",
    model,
    tools: [writeFileTool],
    toolUseBehavior: stopAfterTools,
  })
  try {
    const result = await runAgent(agent, "Write both files now.", { maxTurns: 1 })
    logLine("output (raw items)", result.output)
    const calls = result.output.filter((i: { type?: string }) => i.type === "function_call")
    console.log(`  -> ${calls.length} function_call item(s) found`)
  } catch (e) {
    logLine("ERROR", e instanceof Error ? e.message : e)
  }
}

async function proseAndToolCallProbe(roleName: string, model: ReturnType<typeof getFastModel>) {
  console.log(`\n--- [${roleName}] streaming, PROSE + tool call in one turn (planner shape) ---`)
  const agent = new Agent({
    name: "Probe",
    instructions:
      "First say exactly the sentence \"Sounds good, doing it now.\" as plain text. Then, in the same reply, call the say tool with word=\"done\".",
    model,
    tools: [sayTool],
  })
  try {
    const result = await runAgent(agent, "Go ahead.", { stream: true, maxTurns: 1 })
    let textSeen = ""
    let sawToolCalled = false
    for await (const ev of result as AsyncIterable<RawEvent & { name?: string }>) {
      if (ev.type === "raw_model_stream_event" && ev.data?.type === "output_text_delta") {
        textSeen += ev.data.delta ?? ""
      } else if (ev.type === "run_item_stream_event") {
        logLine(`run_item_stream_event ${(ev as { name?: string }).name}`, ev)
        if ((ev as { name?: string }).name === "tool_called") sawToolCalled = true
      } else {
        logLine(`event ${ev.type}`, ev)
      }
    }
    await result.completed
    if (result.error) throw result.error
    console.log(`  -> text streamed: ${JSON.stringify(textSeen)}`)
    console.log(`  -> saw a tool_called run-item event: ${sawToolCalled}`)
    logLine("output (raw items)", result.output)
  } catch (e) {
    logLine("ERROR", e instanceof Error ? e.message : e)
  }
}

async function main() {
  const coder = getCoderModel()

  for (const [roleName, model] of [["coder", coder]] as const) {
    await nonStreamingProbe(roleName, model)
    await streamingProbe(roleName, model)
    await multiToolCallProbe(roleName, model)
    await proseAndToolCallProbe(roleName, model)
  }

  console.log("\nDone. Review the log above against docs' Phase 1 'done when' criteria.")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
