import { afterEach, describe, expect, it } from "vitest"
import { toolCallingMode } from "@/lib/agent/config"

describe("toolCallingMode", () => {
  const original = process.env.AI_TOOL_CALLING

  afterEach(() => {
    if (original === undefined) delete process.env.AI_TOOL_CALLING
    else process.env.AI_TOOL_CALLING = original
  })

  it("defaults to on when unset", () => {
    delete process.env.AI_TOOL_CALLING
    expect(toolCallingMode()).toBe("on")
  })

  it("is off only for the literal value 'off' (case/whitespace insensitive)", () => {
    process.env.AI_TOOL_CALLING = "off"
    expect(toolCallingMode()).toBe("off")
    process.env.AI_TOOL_CALLING = " OFF "
    expect(toolCallingMode()).toBe("off")
  })

  it("falls back to on for any other value", () => {
    process.env.AI_TOOL_CALLING = "auto"
    expect(toolCallingMode()).toBe("on")
    process.env.AI_TOOL_CALLING = "on"
    expect(toolCallingMode()).toBe("on")
  })
})
