import { describe, expect, it, vi, beforeEach } from "vitest"

const { mockInsert, mockValues, mockOnConflictDoUpdate } = vi.hoisted(() => {
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }))
  const mockInsert = vi.fn(() => ({ values: mockValues }))
  return { mockInsert, mockValues, mockOnConflictDoUpdate }
})

vi.mock("@/db", () => ({
  db: {
    insert: mockInsert,
  },
  imageLibraryMisses: {
    id: "id",
    query: "query",
    collectionLabel: "collection_label",
    subject: "subject",
    hitCount: "hit_count",
    firstSeenAt: "first_seen_at",
    lastSeenAt: "last_seen_at",
  },
}))

const { recordMiss } = await import("@/lib/image-library/misses")

beforeEach(() => {
  mockInsert.mockClear()
  mockValues.mockClear()
  mockOnConflictDoUpdate.mockClear()
})

describe("recordMiss", () => {
  it("normalizes query and inserts or updates hit_count on conflict", async () => {
    await recordMiss("  Quantum Widget 100  ", "Widgets", "Quantum Widget")

    expect(mockInsert).toHaveBeenCalled()
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "quantum widget 100",
        collectionLabel: "Widgets",
        subject: "Quantum Widget",
        hitCount: 1,
      })
    )
    expect(mockOnConflictDoUpdate).toHaveBeenCalled()
  })

  it("skips recording when query is empty or whitespace", async () => {
    await recordMiss("   ")
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("swallows errors so a db failure never breaks callers", async () => {
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error("Connection failed"))
    await expect(recordMiss("Some Query")).resolves.toBeUndefined()
  })
})
