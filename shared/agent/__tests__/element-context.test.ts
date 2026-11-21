import { describe, expect, it } from "vitest"
import { describeElement, elementFile, elementLabel, parseElementRef } from "@app/shared/agent/element-context"

describe("parseElementRef", () => {
  it("accepts a well-formed reference and clips long text", () => {
    const el = parseElementRef({ eid: "app/(tabs)/home.tsx:42:Button", tag: "Button", text: "x".repeat(500), screenId: "home", screenName: "Home" })
    expect(el?.eid).toBe("app/(tabs)/home.tsx:42:Button")
    expect(el?.text).toHaveLength(200)
  })

  it("rejects anything that isn't an eid", () => {
    expect(parseElementRef(null)).toBeUndefined()
    expect(parseElementRef({ eid: "nope", tag: "Button" })).toBeUndefined()
    expect(parseElementRef({ eid: "a.tsx:1:Text" })).toBeUndefined()
  })
})

describe("describeElement", () => {
  const el = { eid: "app/home.tsx:7:Button", tag: "Button", text: "Save", screenName: "Home" }

  it("tells the model which element 'this' means, and where it is", () => {
    const d = describeElement(el)
    expect(d).toContain("<Button>")
    expect(d).toContain("app/home.tsx, line 7")
    expect(d).toContain('"Save"')
    expect(d).toContain('"Home" screen')
  })

  it("exposes the file and a short label", () => {
    expect(elementFile(el)).toBe("app/home.tsx")
    expect(elementLabel(el)).toBe("Button “Save”")
  })
})
