import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ servers: [] as { calls: number; close: ReturnType<typeof vi.fn> }[], behaviours: [] as ((n: number) => unknown)[] }))

vi.mock("@openai/agents", () => ({
  MCPServerStreamableHttp: class {
    calls = 0
    close = vi.fn().mockResolvedValue(undefined)
    private behave: (n: number) => unknown
    constructor() {
      this.behave = state.behaviours.shift() ?? (() => ({ content: [{ type: "text", text: "ok" }] }))
      state.servers.push(this)
    }
    async connect() {}
    async listTools() {
      return [{ name: "get_project" }]
    }
    async callToolResult() {
      const r = this.behave(++this.calls)
      if (r instanceof Error) throw r
      return r
    }
  },
}))

const { withMcp } = await import("../mcp")
const access = { token: "t", mcpUrl: "https://mcp.example/mcp", apiUrl: "https://api.example" }
const reset = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) })

beforeEach(() => {
  state.servers.length = 0
  state.behaviours.length = 0
})

describe("withMcp", () => {
  it("reconnects and retries a call once when the idle connection was reset", async () => {
    state.behaviours.push(() => reset())
    const res = await withMcp(access, (s) => s.call("get_project", {}))
    expect(res).toEqual({ text: "ok", isError: false })
    expect(state.servers).toHaveLength(2)
  })

  it("gives up after one retry", async () => {
    state.behaviours.push(() => reset(), () => reset())
    await expect(withMcp(access, (s) => s.call("get_project", {}))).rejects.toThrow("fetch failed")
  })

  it("does not retry errors that aren't connection resets", async () => {
    state.behaviours.push(() => new Error("boom"))
    await expect(withMcp(access, (s) => s.call("get_project", {}))).rejects.toThrow("boom")
    expect(state.servers).toHaveLength(1)
  })
})
