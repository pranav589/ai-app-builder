import { describe, expect, it } from "vitest"
import { ToolCallStreamAccumulator } from "@/lib/agent/tool-call-stream"

const chunk = (index: number, fn: { name?: string; arguments?: string }) => ({ choices: [{ delta: { tool_calls: [{ index, function: fn }] } }] })

describe("ToolCallStreamAccumulator", () => {
  it("reassembles a tool call split across argument chunks", () => {
    const acc = new ToolCallStreamAccumulator()
    acc.push(chunk(0, { name: "write_file" }))
    acc.push(chunk(0, { arguments: '{"path"' }))
    acc.push(chunk(0, { arguments: ':"a.tsx","content":"x"}' }))
    expect(acc.toToolCallLog()).toEqual([{ name: "write_file", args: { path: "a.tsx", content: "x" } }])
  })

  it("ignores a repeated full name on later chunks instead of concatenating it (the confirmed gateway quirk)", () => {
    const acc = new ToolCallStreamAccumulator()
    acc.push(chunk(0, { name: "write_file" }))
    acc.push(chunk(0, { name: "write_file" }))
    acc.push(chunk(0, { name: "write_file", arguments: '{"path":"a.tsx","content":"x"}' }))
    expect(acc.toToolCallLog()).toEqual([{ name: "write_file", args: { path: "a.tsx", content: "x" } }])
  })

  it("keeps multiple tool calls separate by index, in order", () => {
    const acc = new ToolCallStreamAccumulator()
    acc.push(chunk(0, { name: "write_file", arguments: '{"path":"a.tsx","content":"A"}' }))
    acc.push(chunk(1, { name: "write_file", arguments: '{"path":"b.tsx","content":"B"}' }))
    expect(acc.toToolCallLog()).toEqual([
      { name: "write_file", args: { path: "a.tsx", content: "A" } },
      { name: "write_file", args: { path: "b.tsx", content: "B" } },
    ])
  })

  it("drops a call whose arguments never became valid JSON (a cut-off stream)", () => {
    const acc = new ToolCallStreamAccumulator()
    acc.push(chunk(0, { name: "write_file", arguments: '{"path":"a.tsx"' }))
    expect(acc.toToolCallLog()).toEqual([])
  })

  it("exposes the still-partial arguments JSON for live progress UIs", () => {
    const acc = new ToolCallStreamAccumulator()
    acc.push(chunk(0, { name: "propose_plan", arguments: '{"plan":{"screens":[{"name":"Hom' }))
    expect(acc.partialArgsJson(0)).toBe('{"plan":{"screens":[{"name":"Hom')
    expect(acc.size).toBe(1)
  })

  it("ignores chunks with no tool_calls (plain text deltas)", () => {
    const acc = new ToolCallStreamAccumulator()
    acc.push({ choices: [{ delta: { content: "hello" } }] })
    expect(acc.size).toBe(0)
  })
})
