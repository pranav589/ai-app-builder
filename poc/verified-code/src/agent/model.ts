import OpenAI from "openai"

// Model adapter over the same OpenAI-compatible gateway the app uses (AI_BASE_URL,
// AI_API_KEY, AI_MODEL). Swapping providers means changing only this file.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }
export type Completion = { text: string; ms: number; finishReason?: string | null; usage?: { prompt?: number; completion?: number } }

let client: OpenAI | null = null

/** The POC's model. POC_MODEL overrides it; the main app's AI_MODEL is not used. */
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5"

export function modelName() {
  return process.env.POC_MODEL?.trim() || DEFAULT_MODEL
}

/** Billing and auth errors: retrying or continuing other tasks can't succeed. */
export function isFatalProviderError(e: unknown) {
  const status = (e as { status?: number })?.status
  return status === 401 || status === 402 || status === 403
}

export async function complete(messages: ChatMessage[], opts: { model: string; maxTokens?: number }): Promise<Completion> {
  const apiKey = process.env.AI_API_KEY
  const baseURL = process.env.AI_BASE_URL
  if (!apiKey || !baseURL) throw new Error("AI_API_KEY and AI_BASE_URL must be set.")
  client ??= new OpenAI({ apiKey, baseURL, timeout: 240_000, maxRetries: 1 })

  const effort = process.env.AI_REASONING_EFFORT?.trim().toLowerCase()
  const extra: Record<string, unknown> = {}
  if (effort && effort !== "none") {
    if (/openrouter\.ai/i.test(baseURL)) extra.reasoning = { effort: effort === "minimal" ? "low" : effort }
    else extra.reasoning_effort = effort
  }

  const t0 = performance.now()
  const res = await client.chat.completions.create({
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens ?? 16000,
    ...extra,
  } as OpenAI.ChatCompletionCreateParamsNonStreaming)
  const choice = res.choices[0]
  return {
    text: choice?.message?.content ?? "",
    ms: performance.now() - t0,
    finishReason: choice?.finish_reason,
    usage: { prompt: res.usage?.prompt_tokens, completion: res.usage?.completion_tokens },
  }
}
