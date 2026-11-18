import { describe, expect, it } from "vitest"
import { classifyOwner } from "@/components/workspace/app-files"

describe("classifyOwner", () => {
  it("marks platform files platform", () => {
    expect(classifyOwner("theme/index.tsx")).toBe("platform")
    expect(classifyOwner("lib/backend/index.ts")).toBe("platform")
    expect(classifyOwner("package.json")).toBe("platform")
  })

  it("marks compiler-owned paths generated", () => {
    expect(classifyOwner("app/_layout.tsx")).toBe("generated")
    expect(classifyOwner("app/(tabs)/_layout.tsx")).toBe("generated")
    expect(classifyOwner("lib/nav.ts")).toBe("generated")
    expect(classifyOwner("data/types.ts")).toBe("generated")
  })

  it("marks a screen file app", () => {
    expect(classifyOwner("app/(tabs)/home.tsx")).toBe("app")
    expect(classifyOwner("components/HabitCard.tsx")).toBe("app")
  })

  it("marks the kit platform-owned", () => {
    expect(classifyOwner("kit/index.tsx")).toBe("platform")
  })
})
