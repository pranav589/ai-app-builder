import "server-only"
import { MCPServerStreamableHttp } from "@openai/agents"

import type { CloudHikeAccess } from "./connect"

// CloudHike's MCP server (https://cloudhike.dev/docs/mcp), over Streamable
// HTTP with the user's Connect token. The tool list and each tool's input
// schema come from the server itself (tools/list).

export class CloudHikeRevokedError extends Error {
  constructor() {
    super("CloudHike no longer accepts this connection. Connect your account again.")
  }
}

export class CloudHikeRateLimitError extends Error {}

export type McpTool = { name: string; description?: string; inputSchema?: unknown }

export type McpSession = {
  tools: McpTool[]
  /** Calls a tool and returns its result as text (JSON stays JSON text). */
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>
}

function classify(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (/\b401\b|invalid or revoked|missing or invalid api key|unauthori[sz]ed/i.test(msg)) throw new CloudHikeRevokedError()
  if (/\b429\b|too many requests/i.test(msg)) throw new CloudHikeRateLimitError("CloudHike is rate limiting requests. Try again in a minute.")
  throw e
}

function contentText(content: unknown): string {
  const items = Array.isArray(content) ? content : []
  return items
    .map((c: { type?: string; text?: string; resource?: { text?: string } }) =>
      c?.type === "text" ? (c.text ?? "") : c?.resource?.text ?? (c ? JSON.stringify(c) : "")
    )
    .join("\n")
    .trim()
}

/** Opens an MCP session for one job and always closes it. */
export async function withMcp<T>(access: CloudHikeAccess, fn: (session: McpSession) => Promise<T>): Promise<T> {
  const server = new MCPServerStreamableHttp({
    url: access.mcpUrl,
    name: "cloudhike",
    cacheToolsList: true,
    timeout: 90_000,
    requestInit: { headers: { authorization: `Bearer ${access.token}` } },
  })
  try {
    await server.connect().catch(classify)
    const tools = (await server.listTools().catch(classify)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    const session: McpSession = {
      tools,
      async call(name, args) {
        try {
          const r = await server.callToolResult(name, args)
          const res = r as unknown as { content?: unknown; isError?: boolean; structuredContent?: unknown }
          const text = contentText(res.content) || (res.structuredContent ? JSON.stringify(res.structuredContent) : "")
          return { text, isError: !!res.isError }
        } catch (e) {
          return classify(e)
        }
      },
    }
    return await fn(session)
  } finally {
    await server.close().catch(() => {})
  }
}

/** Reads `KEY=value` lines (quotes, comments, `export`), or a JSON object of strings. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const src = (obj.env && typeof obj.env === "object" ? obj.env : obj.variables && typeof obj.variables === "object" ? obj.variables : obj) as Record<string, unknown>
      for (const [k, v] of Object.entries(src)) if (/^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === "string") out[k] = v
      if (Object.keys(out).length) return out
    } catch {}
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, "")
    out[m[1]] = v
  }
  return out
}
