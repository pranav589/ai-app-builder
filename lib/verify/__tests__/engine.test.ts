import { describe, expect, it } from "vitest"
import { engineOf } from "@/lib/verify/engine"

describe("engineOf", () => {
  it("returns the project's engine when valid", () => {
    expect(engineOf({ engine: "verified" })).toBe("verified")
    expect(engineOf({ engine: "legacy" })).toBe("legacy")
  })

  it("defaults to legacy for null, undefined or an unrecognized value", () => {
    expect(engineOf({ engine: null })).toBe("legacy")
    expect(engineOf({})).toBe("legacy")
    expect(engineOf({ engine: "bogus" })).toBe("legacy")
  })
})
