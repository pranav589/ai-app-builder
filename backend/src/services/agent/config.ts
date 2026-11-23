import OpenAI from "openai"
import { OpenAIChatCompletionsModel, setTracingDisabled } from "@openai/agents"

// The AI gateway (AI_BASE_URL) is OpenAI-compatible but only serves
// /chat/completions, and it does not pass function/tool calls through. So every
// agent here runs on the Chat Completions model and talks in plain text; the
// structured parts (plan, approval) are tagged blocks parsed by lib/agent/protocol.

// Tracing would try to export to api.openai.com with a key that isn't one.
setTracingDisabled(true)

let client: OpenAI | null = null
let model: OpenAIChatCompletionsModel | null = null
let fastModel: OpenAIChatCompletionsModel | null = null
let coderModel: OpenAIChatCompletionsModel | null = null

export class AgentConfigError extends Error {}

function getClient() {
  if (client) return client
  const apiKey = process.env.AI_API_KEY
  const baseURL = process.env.AI_BASE_URL
  if (!apiKey || !baseURL || !process.env.AI_MODEL) {
    throw new AgentConfigError("AI_API_KEY, AI_BASE_URL and AI_MODEL must be set")
  }
  // The gateway can sit silent for a long time before the first token, so the
  // timeout is generous; one retry covers transient gateway errors.
  client = new OpenAI({ apiKey, baseURL, timeout: 180_000, maxRetries: 1 })
  return client
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high"
const EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high"]

/**
 * How much hidden reasoning the model may do before answering. Reasoning
 * tokens are billed and streamed to nobody: on long code files the default
 * spent ~11k tokens (~45s) before the first visible line. "low" roughly
 * halves that; "none" is fastest. Set with AI_REASONING_EFFORT.
 */
export function reasoningEffort(): ReasoningEffort {
  const v = process.env.AI_REASONING_EFFORT?.trim().toLowerCase() as ReasoningEffort | undefined
  return v && EFFORTS.includes(v) ? v : "low"
}

/**
 * Extra request fields for gateways with their own reasoning switch.
 * OpenRouter takes a `reasoning` object (and drops `reasoning_effort` for
 * some models), so send its form too.
 */
export function reasoningProviderData(): Record<string, unknown> {
  if (!/openrouter\.ai/i.test(process.env.AI_BASE_URL ?? "")) return {}
  const effort = reasoningEffort()
  return { reasoning: effort === "none" ? { enabled: false } : { effort: effort === "minimal" ? "low" : effort } }
}

/** The main model: planning conversations, the app shell and screens. */
export function getModel() {
  model ??= new OpenAIChatCompletionsModel(getClient(), process.env.AI_MODEL!)
  return model
}

/**
 * A faster model for support work (themes + data, code fixes, edits).
 * Set AI_MODEL_FAST to a high-throughput model; without it the main model is used.
 */
export function getFastModel() {
  const name = process.env.AI_MODEL_FAST?.trim()
  if (!name) return getModel()
  fastModel ??= new OpenAIChatCompletionsModel(getClient(), name)
  return fastModel
}

/**
 * The coder model (writes ChangeSets through the change gateway). Set
 * AI_MODEL_CODER to a model good at small, precise diffs; without it the
 * main model is used.
 */
export function getCoderModel() {
  const name = process.env.AI_MODEL_CODER?.trim()
  if (!name) return getModel()
  coderModel ??= new OpenAIChatCompletionsModel(getClient(), name)
  return coderModel
}
