import { describe, expect, it } from "vitest"
import { regenOutcome, screenSideFiles, storedSideFiles } from "@/lib/agent/generation-guard"
import type { GeneratedScreen } from "@app/shared/agent/types"

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

describe("screenSideFiles", () => {
  const before = { "components/Button.tsx": "shell button", "theme/index.tsx": "theme" }

  it("keeps the new component files a screen was split into, which it imports", () => {
    const after = { ...before, "app/home.tsx": "screen", "components/home/HabitRow.tsx": "row", "lib/streaks.ts": "helper" }
    const out = screenSideFiles("app/home.tsx", before, after, ["app/home.tsx", "components/home/HabitRow.tsx", "lib/streaks.ts"])
    expect(out).toEqual({ "components/home/HabitRow.tsx": "row", "lib/streaks.ts": "helper" })
  })

  it("drops edits to files that already existed, other screens, and platform files", () => {
    const after = { ...before, "components/Button.tsx": "changed", "app/other.tsx": "other", "theme/index.tsx": "changed" }
    expect(screenSideFiles("app/home.tsx", before, after, ["components/Button.tsx", "app/other.tsx", "theme/index.tsx"])).toEqual({})
  })
})

describe("storedSideFiles", () => {
  it("keeps helper files through a rebuild, but not screens, shell or platform files", () => {
    const files = { "components/home/HabitRow.tsx": "row", "lib/streaks.ts": "helper", "components/Button.tsx": "shell", "app/home.tsx": "screen", "kit/index.tsx": "kit" }
    expect(storedSideFiles(files, (p) => /^components\/[\w-]+\.tsx?$/.test(p))).toEqual({ "components/home/HabitRow.tsx": "row", "lib/streaks.ts": "helper" })
  })
})
