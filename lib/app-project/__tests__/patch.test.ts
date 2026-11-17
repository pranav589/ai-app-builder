import { describe, expect, it } from "vitest"
import { applyHunks, parseEdits } from "@/lib/app-project/patch"

describe("parseEdits", () => {
  it("parses a single search/replace hunk", () => {
    const raw = `<edit path="app/home.tsx">
<<<<<<< SEARCH
const x = 1
=======
const x = 2
>>>>>>> REPLACE
</edit>`
    const edits = parseEdits(raw)
    expect(edits).toEqual([
      { path: "app/home.tsx", kind: "patch", hunks: [{ search: "const x = 1", replace: "const x = 2" }] },
    ])
  })

  it("parses multiple hunks for the same file", () => {
    const raw = `<edit path="app/home.tsx">
<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE
<<<<<<< SEARCH
c
=======
d
>>>>>>> REPLACE
</edit>`
    const edit = parseEdits(raw)[0]
    if (edit.kind !== "patch") throw new Error("expected a patch edit")
    expect(edit.hunks).toHaveLength(2)
  })

  it("parses a whole-file replacement, stripping a code fence", () => {
    const raw = `<file path="app/home.tsx">
\`\`\`tsx
export default function Home() {}
\`\`\`
</file>`
    const edits = parseEdits(raw)
    expect(edits).toEqual([{ path: "app/home.tsx", kind: "file", code: "export default function Home() {}\n" }])
  })

  it("strips a leading slash from the path", () => {
    const raw = `<file path="/app/home.tsx">content</file>`
    expect(parseEdits(raw)[0].path).toBe("app/home.tsx")
  })
})

describe("applyHunks", () => {
  it("applies an exact match", () => {
    const { code, failed } = applyHunks("const x = 1\nconst y = 2\n", [{ search: "const x = 1", replace: "const x = 99" }])
    expect(code).toBe("const x = 99\nconst y = 2\n")
    expect(failed).toHaveLength(0)
  })

  it("matches ignoring trailing whitespace when there's no exact match", () => {
    const { code, failed } = applyHunks("const x = 1\n", [{ search: "const x = 1  ", replace: "const x = 2" }])
    expect(code).toBe("const x = 2\n")
    expect(failed).toHaveLength(0)
  })

  it("reports a hunk that can't be located", () => {
    const { code, failed } = applyHunks("const x = 1\n", [{ search: "const z = 9", replace: "const z = 10" }])
    expect(code).toBe("const x = 1\n")
    expect(failed).toEqual([{ search: "const z = 9", replace: "const z = 10" }])
  })

  it("applies hunks in order", () => {
    const { code } = applyHunks("one\ntwo\nthree\n", [
      { search: "one", replace: "ONE" },
      { search: "three", replace: "THREE" },
    ])
    expect(code).toBe("ONE\ntwo\nTHREE\n")
  })

  it("refuses an ambiguous match (more than one occurrence)", () => {
    const { failed } = applyHunks("dup\ndup\n", [{ search: "dup", replace: "x" }])
    expect(failed).toHaveLength(1)
  })
})
