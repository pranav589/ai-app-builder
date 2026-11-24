// Real tool-calling for the verified coder and router, replacing the tagged
// blocks protocol.ts parses out of plain text (see docs/tool-calling probe:
// the gateway does pass tool calls through; the old assumption that it
// doesn't, in lib/agent/config.ts, was never actually tested).
//
// Every tool here is an inert accumulator: `execute` only records the parsed
// call onto the per-run `ToolCallLog` passed as the run's `context` (never a
// module-level variable, since concurrent runs for different projects must
// not share state) and returns a fixed string. Nothing a tool call carries is
// trusted until the gate pipeline verifies the ChangeSet built from it --
// same invariant the tagged-block path already has.

import { z } from "zod"
import { tool } from "@openai/agents"

import type { ChangeSet, FileChange, JsonPatchOp } from "@app/shared/verify/types"
import { ROUTES, type Route, type RouterReply } from "./router"

export type ToolCallLog = { name: string; args: unknown }[]

/** Stops the Agent's own tool loop after the first batch of tool calls: the
 * run/repair loop in run.ts owns any follow-up, not a second model turn
 * feeding tool results back (confirmed necessary in the live probe -- the
 * SDK's default `toolUseBehavior` needs `maxTurns >= 2` otherwise). */
export const stopAfterToolCalls = () => ({ isFinalOutput: true as const, isInterrupted: undefined, finalOutput: "ok" })

const hunkSchema = z.object({ search: z.string(), replace: z.string() })

const jsonPatchOpSchema = z.union([
  z.object({ op: z.enum(["add", "replace"]), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: z.string() }),
]) satisfies z.ZodType<JsonPatchOp>

/** Shared by every tools module in this app (verify and agent): an inert
 * `execute` that just records the call onto whatever `ToolCallLog` array was
 * passed as the run's `context`. */
export const record = (name: string) =>
  async (input: unknown, ctx?: { context?: unknown }) => {
    const log = ctx?.context
    if (Array.isArray(log)) log.push({ name, args: input })
    return "queued"
  }

// Parameter schemas are exported on their own (not just wrapped in `tool()`,
// whose `.parameters` is the converted JSON Schema the API sends, not the
// zod object) so tests can validate them directly with `.parse()`.

export const writeFileParams = z.object({
  path: z.string().describe("Project-relative file path, e.g. app/(tabs)/home.tsx"),
  content: z.string().describe("The complete file content."),
})
export const writeFileTool = tool({
  name: "write_file",
  description: "Create a new file, or replace one that already exists, in full. Use for new files and for changes big enough to touch most of the file.",
  parameters: writeFileParams,
  execute: record("write_file"),
})

export const editFileParams = z.object({ path: z.string(), hunks: z.array(hunkSchema).min(1) })
export const editFileTool = tool({
  name: "edit_file",
  description:
    "Apply one or more search/replace hunks to a file that already exists. Each hunk's `search` must match the current file's text exactly, once. Prefer this over write_file for small, targeted changes.",
  parameters: editFileParams,
  execute: record("edit_file"),
})

export const deleteFileParams = z.object({ path: z.string() })
export const deleteFileTool = tool({
  name: "delete_file",
  description: "Delete a file that is no longer needed.",
  parameters: deleteFileParams,
  execute: record("delete_file"),
})

export const patchManifestParams = z.object({ ops: z.array(jsonPatchOpSchema).min(1) })
export const patchManifestTool = tool({
  name: "patch_manifest",
  description:
    "Apply RFC 6902 JSON Patch operations to the app manifest (screens, navigation, tabs). Call this in the same turn as the matching write_file when adding a screen; the screen won't appear in navigation without it.",
  parameters: patchManifestParams,
  execute: record("patch_manifest"),
})

export const askQuestionParams = z.object({ question: z.string() })
export const askQuestionTool = tool({
  name: "ask_question",
  description:
    "Call this INSTEAD of any file tool when the request can't be done without the user's input, needs a capability this app builder doesn't support, or is too vague to act on. Never combine with a file tool in the same turn.",
  parameters: askQuestionParams,
  execute: record("ask_question"),
})

/** The coder's full tool set. */
export const CODER_TOOLS = [writeFileTool, editFileTool, deleteFileTool, patchManifestTool, askQuestionTool]

/** The written files from a log's write_file calls, in call order (a later call for the same path wins). Used by the shell, which only ever writes whole files. */
export function toolCallsToFileMap(log: ToolCallLog): Record<string, string> {
  const files: Record<string, string> = {}
  for (const call of log) if (call.name === "write_file") files[(call.args as { path: string }).path] = (call.args as { content: string }).content
  return files
}

/**
 * Maps an accumulated tool-call log back to the exact shape `parseReply()`
 * already produces, so the gate pipeline and run state machine need no
 * changes regardless of which path produced the ChangeSet.
 */
export function toolCallsToChangeSet(log: ToolCallLog, intent = ""): { changeSet: ChangeSet; question?: string } {
  const files: FileChange[] = []
  let manifestPatch: JsonPatchOp[] = []
  let question: string | undefined

  for (const call of log) {
    switch (call.name) {
      case "write_file": {
        const a = call.args as { path: string; content: string }
        files.push({ path: a.path, op: "write", content: a.content })
        break
      }
      case "edit_file": {
        const a = call.args as { path: string; hunks: { search: string; replace: string }[] }
        files.push({ path: a.path, op: "edit", hunks: a.hunks })
        break
      }
      case "delete_file": {
        const a = call.args as { path: string }
        files.push({ path: a.path, op: "delete" })
        break
      }
      case "patch_manifest": {
        const a = call.args as { ops: JsonPatchOp[] }
        manifestPatch = manifestPatch.concat(a.ops)
        break
      }
      case "ask_question": {
        const a = call.args as { question: string }
        question = a.question
        break
      }
    }
  }

  return { changeSet: { intent, manifestPatch, files }, question }
}

/** A readable summary of a tool-call log, for the model's own conversational
 * memory across a repair round (the run/repair loop threads turns as plain
 * text, not through the SDK's native tool-result history). */
export function describeToolCalls(log: ToolCallLog): string {
  return log.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join("\n")
}

export const classifyParams = z.object({
  route: z.enum(ROUTES),
  targets: z.array(z.string()).optional().describe("Screen ids the message is about, for route \"edit\"."),
  answer: z.string().optional().describe("Required for \"question\", \"integration\" or \"unsupported\"; omitted otherwise."),
})
export const classifyTool = tool({
  name: "classify",
  description: "Classify the user's latest message into exactly one route for the app builder to act on.",
  parameters: classifyParams,
  execute: record("classify"),
})

export function toolCallsToRouterReply(log: ToolCallLog): RouterReply | null {
  const call = log.find((c) => c.name === "classify")
  if (!call) return null
  const a = call.args as { route: Route; targets?: string[]; answer?: string }
  return { route: a.route, targets: a.targets ?? [], answer: a.answer }
}
