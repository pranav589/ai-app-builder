import { describe, expect, it } from "vitest"
import { classifyOwner } from "@/components/workspace/app-files"

describe("classifyOwner", () => {
  it("marks platform files platform in both engines", () => {
    for (const engine of ["legacy", "verified"] as const) {
      expect(classifyOwner("theme/index.tsx", engine)).toBe("platform")
      expect(classifyOwner("lib/backend/index.ts", engine)).toBe("platform")
      expect(classifyOwner("package.json", engine)).toBe("platform")
    }
  })

  it("marks compiler-owned paths generated only on the verified engine", () => {
    expect(classifyOwner("app/_layout.tsx", "verified")).toBe("generated")
    expect(classifyOwner("app/(tabs)/_layout.tsx", "verified")).toBe("generated")
    expect(classifyOwner("lib/nav.ts", "verified")).toBe("generated")
    expect(classifyOwner("data/types.ts", "verified")).toBe("generated")
  })

  it("marks the same compiler-owned paths app (AI-written) on the legacy engine", () => {
    expect(classifyOwner("app/_layout.tsx", "legacy")).toBe("app")
    expect(classifyOwner("lib/nav.ts", "legacy")).toBe("app")
  })

  it("marks a screen file app in both engines", () => {
    expect(classifyOwner("app/(tabs)/home.tsx", "verified")).toBe("app")
    expect(classifyOwner("app/(tabs)/home.tsx", "legacy")).toBe("app")
    expect(classifyOwner("components/HabitCard.tsx", "verified")).toBe("app")
  })

  it("marks the kit platform-owned only where it exists (verified)", () => {
    expect(classifyOwner("kit/index.tsx", "verified")).toBe("platform")
  })
})
