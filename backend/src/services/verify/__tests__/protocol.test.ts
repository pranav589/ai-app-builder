import { describe, expect, it } from "vitest"
import { parseReply } from "@/lib/verify/protocol"

describe("parseReply", () => {
  it("parses intent, an edit and a file", () => {
    const raw = `<intent>Make the header bigger.</intent>
<edit path="app/home.tsx">
<<<<<<< SEARCH
fontSize: 17
=======
fontSize: 22
>>>>>>> REPLACE
</edit>
<file path="components/Card.tsx">
export const Card = () => null
</file>`
    const r = parseReply(raw)
    expect(r.changeSet.intent).toBe("Make the header bigger.")
    expect(r.changeSet.files).toEqual([
      { path: "components/Card.tsx", op: "write", content: "export const Card = () => null\n" },
      { path: "app/home.tsx", op: "edit", hunks: [{ search: "fontSize: 17", replace: "fontSize: 22" }] },
    ])
    expect(r.problems).toEqual([])
  })

  it("parses a delete", () => {
    const r = parseReply(`<intent>Remove it.</intent><delete path="components/Old.tsx"/>`)
    expect(r.changeSet.files).toEqual([{ path: "components/Old.tsx", op: "delete" }])
  })

  it("parses a question", () => {
    const r = parseReply(`<question>Maps aren't supported yet. Want a list of places instead?</question>`)
    expect(r.question).toBe("Maps aren't supported yet. Want a list of places instead?")
    expect(r.changeSet.files).toEqual([])
  })

  it("flags an edit with no SEARCH/REPLACE blocks", () => {
    const r = parseReply(`<edit path="app/home.tsx">nothing useful here</edit>`)
    expect(r.problems[0]).toMatch(/no SEARCH\/REPLACE/)
  })

  it("flags an unclosed file block as a possible cutoff", () => {
    const r = parseReply(`<file path="app/home.tsx">\nexport default function Home() {`)
    expect(r.problems.some((p) => p.includes("wasn't closed"))).toBe(true)
  })

  it("flags a reply with nothing recognizable", () => {
    const r = parseReply("just some prose, no tags")
    expect(r.problems).toEqual(["The reply had no <file>, <edit>, <delete> or <question> block."])
  })

  it("parses a manifest_patch array", () => {
    const r = parseReply(`<manifest_patch>[{"op":"remove","path":"/screens/x"}]</manifest_patch>`)
    expect(r.changeSet.manifestPatch).toEqual([{ op: "remove", path: "/screens/x" }])
  })

  it("flags invalid JSON in manifest_patch without crashing", () => {
    const r = parseReply(`<manifest_patch>{not json</manifest_patch>`)
    expect(r.problems[0]).toMatch(/not valid JSON/)
  })
})
