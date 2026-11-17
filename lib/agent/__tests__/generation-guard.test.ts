import { describe, expect, it } from "vitest"
import { regenOutcome } from "@/lib/agent/generation-guard"
import type { GeneratedScreen } from "@/lib/agent/types"

const readyScreen: GeneratedScreen = { id: "home", name: "Home", state: "ready", path: "app/home.tsx", code: "old code" }

describe("regenOutcome", () => {
  it("uses the freshly generated code when it succeeded", () => {
    const out = regenOutcome(readyScreen, "app/home.tsx", "new code", undefined)
    expect(out).toEqual({ patch: { state: "ready", code: "new code", path: "app/home.tsx", error: undefined }, kept: false, failed: false })
  })

  it("keeps the previous ready screen's code when regeneration fails", () => {
    const out = regenOutcome(readyScreen, "app/home.tsx", "", "boom")
    expect(out.kept).toBe(true)
    expect(out.failed).toBe(false)
    expect(out.patch).toEqual({ state: "ready", code: "old code", path: "app/home.tsx", error: undefined })
  })

  it("errors when there was no previous ready version to fall back to", () => {
    const pending: GeneratedScreen = { id: "home", name: "Home", state: "pending" }
    const out = regenOutcome(pending, "app/home.tsx", "", "boom")
    expect(out.kept).toBe(false)
    expect(out.failed).toBe(true)
    expect(out.patch).toEqual({ state: "error", error: "boom" })
  })

  it("errors when there was no previous screen at all (a brand new screen)", () => {
    const out = regenOutcome(undefined, "app/new.tsx", "", "boom")
    expect(out.failed).toBe(true)
    expect(out.patch).toEqual({ state: "error", error: "boom" })
  })

  it("doesn't fall back to a previous version that errored, not readied", () => {
    const errored: GeneratedScreen = { id: "home", name: "Home", state: "error", code: "old code", path: "app/home.tsx" }
    const out = regenOutcome(errored, "app/home.tsx", "", "boom")
    expect(out.failed).toBe(true)
    expect(out.kept).toBe(false)
  })
})
