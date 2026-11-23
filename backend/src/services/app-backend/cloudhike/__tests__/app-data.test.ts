import { describe, expect, it } from "vitest"
import { toColumnValue } from "../app-data"

describe("toColumnValue", () => {
  it("passes through a valid ISO date string unchanged", () => {
    expect(toColumnValue("date", "2026-01-15T00:00:00.000Z")).toBe("2026-01-15T00:00:00.000Z")
  })

  it("drops an empty or malformed date string instead of leaving a value postgres.js's own serializer would crash on", () => {
    // postgres.js's date type does `new Date(v).toISOString()` with no validation of its own
    // (src/types.js), so a bad value here would otherwise throw RangeError: Invalid time value
    // mid-insert and abort the whole provisioning transaction.
    expect(toColumnValue("date", "")).toBeNull()
    expect(toColumnValue("date", "not a date")).toBeNull()
    expect(toColumnValue("date", 42)).toBeNull()
  })

  it("coerces a numeric/boolean field the same way regardless of input type", () => {
    expect(toColumnValue("number", "12")).toBe(12)
    expect(toColumnValue("boolean", "true")).toBe(true)
    expect(toColumnValue("boolean", false)).toBe(false)
  })

  it("maps undefined and null to a plain null for every field type", () => {
    expect(toColumnValue("string", undefined)).toBeNull()
    expect(toColumnValue("date", null)).toBeNull()
  })

  it("leaves a string field's value alone", () => {
    expect(toColumnValue("string", "hello")).toBe("hello")
  })
})
