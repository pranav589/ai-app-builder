import { describe, expect, it } from "vitest"
import { diffLines, diffWorkspaces, withContext } from "@/lib/versions/diff"

describe("diffLines", () => {
  it("returns pure context when nothing changed", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc")
    expect(d.every((l) => l.type === "context")).toBe(true)
    expect(d.map((l) => l.line)).toEqual(["a", "b", "c"])
  })

  it("finds an added line", () => {
    const d = diffLines("a\nb", "a\nx\nb")
    expect(d).toEqual([
      { type: "context", line: "a" },
      { type: "add", line: "x" },
      { type: "context", line: "b" },
    ])
  })

  it("finds a removed line", () => {
    const d = diffLines("a\nx\nb", "a\nb")
    expect(d).toEqual([
      { type: "context", line: "a" },
      { type: "remove", line: "x" },
      { type: "context", line: "b" },
    ])
  })

  it("handles a full rewrite", () => {
    const d = diffLines("one\ntwo", "three\nfour")
    expect(d.filter((l) => l.type === "context")).toHaveLength(0)
    expect(d.filter((l) => l.type === "remove").map((l) => l.line)).toEqual(["one", "two"])
    expect(d.filter((l) => l.type === "add").map((l) => l.line)).toEqual(["three", "four"])
  })

  it("handles an empty before (added file)", () => {
    expect(diffLines("", "a\nb").every((l) => l.type !== "remove")).toBe(true)
  })
})

describe("withContext", () => {
  it("collapses far-apart changes with an ellipsis, keeping only nearby context", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ type: "context" as const, line: `l${i}` }))
    lines[0] = { type: "remove", line: "l0" } as never
    lines[19] = { type: "add", line: "l19" } as never
    const out = withContext(lines, 1)
    expect(out.some((l) => l.line === "…")).toBe(true)
    expect(out.length).toBeLessThan(lines.length)
  })

  it("keeps everything when changes are close together", () => {
    const lines = [
      { type: "remove" as const, line: "a" },
      { type: "context" as const, line: "b" },
      { type: "add" as const, line: "c" },
    ]
    expect(withContext(lines, 3)).toEqual(lines)
  })
})

describe("diffWorkspaces", () => {
  it("reports added, removed and modified files, and skips unchanged ones", () => {
    const before = { "a.ts": "same\n", "b.ts": "old\n", "c.ts": "gone\n" }
    const after = { "a.ts": "same\n", "b.ts": "new\n", "d.ts": "new file\n" }
    const diffs = diffWorkspaces(before, after)
    expect(diffs.map((d) => d.path)).toEqual(["b.ts", "c.ts", "d.ts"])
    expect(diffs.find((d) => d.path === "b.ts")?.status).toBe("modified")
    expect(diffs.find((d) => d.path === "c.ts")?.status).toBe("removed")
    expect(diffs.find((d) => d.path === "d.ts")?.status).toBe("added")
  })

  it("returns nothing for two identical workspaces", () => {
    const ws = { "a.ts": "x\n" }
    expect(diffWorkspaces(ws, { ...ws })).toEqual([])
  })
})
