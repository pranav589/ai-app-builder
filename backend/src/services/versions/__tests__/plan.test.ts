import { describe, expect, it } from "vitest"
import { selectPrune, versionsToCommit } from "@/lib/versions/plan"

describe("versionsToCommit", () => {
  it("starts a brand new project at version 1 with no parent", () => {
    expect(versionsToCommit(0, false)).toEqual({ parent: null, next: 1 })
  })

  it("commits an existing legacy doc as version 1 first, then the new doc as version 2", () => {
    expect(versionsToCommit(0, true)).toEqual({ initial: 1, parent: 1, next: 2 })
  })

  it("advances from the current version for an already-versioned project", () => {
    expect(versionsToCommit(1, true)).toEqual({ parent: 1, next: 2 })
    expect(versionsToCommit(5, true)).toEqual({ parent: 5, next: 6 })
  })
})

describe("selectPrune", () => {
  it("keeps nothing to prune when under the limit", () => {
    expect(selectPrune([1, 2, 3], 50)).toEqual([])
  })

  it("prunes everything older than the newest `keep` versions", () => {
    const versions = Array.from({ length: 55 }, (_, i) => i + 1)
    const pruned = selectPrune(versions, 50)
    expect(pruned).toHaveLength(5)
    expect(pruned).toEqual([5, 4, 3, 2, 1])
  })

  it("doesn't assume the input is sorted", () => {
    expect(selectPrune([3, 1, 2], 2)).toEqual([1])
  })
})
