import { describe, expect, it, vi, beforeEach } from "vitest"

const { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn()
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))
  return { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect }
})

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
  },
  imageLibrary: {
    id: "id",
    url: "url",
    category: "category",
    tags: "tags",
    description: "description",
    search: "search",
  },
}))

const { findLibraryImage, tokenizeQuery, MIN_RANK_THRESHOLD } = await import("@/lib/image-library/match")

beforeEach(() => {
  mockSelect.mockClear()
  mockFrom.mockClear()
  mockWhere.mockClear()
  mockOrderBy.mockClear()
  mockLimit.mockReset()
})

describe("tokenizeQuery", () => {
  it("extracts clean alphanumeric tokens stripped of stopwords", () => {
    const tokens = tokenizeQuery("The Retro High Sneakers in White", "Shoes")
    expect(tokens).toEqual(["retro", "high", "sneakers", "white", "shoes"])
  })

  it("returns empty array when all words are stopwords or empty", () => {
    expect(tokenizeQuery("and or the in", "for with")).toEqual([])
    expect(tokenizeQuery("", "")).toEqual([])
  })
})

describe("findLibraryImage", () => {
  it("returns best matching image when rank meets threshold and 2+ tokens overlap (no category given)", () => {
    mockLimit.mockResolvedValue([
      { id: "img-1", url: "https://ik.imagekit.io/lib/sneaker1.jpg", category: "shoes", tags: ["running", "shoes"], description: "Running shoe", rank: 0.45 },
    ])

    return findLibraryImage("Running Shoes", "Products").then((match) => {
      expect(match).toEqual({ id: "img-1", url: "https://ik.imagekit.io/lib/sneaker1.jpg" })
      expect(mockSelect).toHaveBeenCalled()
    })
  })

  it("rejects a single-token-overlap match when no category is given (the leather-watch bug)", async () => {
    // "Classic Leather" + "Products" only overlaps "leather" with this jewelry item's text,
    // even though its rank happens to clear the threshold.
    mockLimit.mockResolvedValue([
      { id: "watch-1", url: "https://ik.imagekit.io/lib/watch.jpg", category: "jewelry", tags: ["leather", "watch"], description: "Leather strap watch", rank: 0.5 },
    ])

    const match = await findLibraryImage("Classic Leather", "Products")
    expect(match).toBeNull()
  })

  it("hard-filters to the given category, allowing a single-token overlap", async () => {
    mockLimit.mockResolvedValue([
      { id: "shoe-1", url: "https://ik.imagekit.io/lib/shoe.jpg", category: "shoes", tags: ["leather", "loafer"], description: "Leather loafer", rank: 0.5 },
    ])

    const match = await findLibraryImage("Classic Leather", "Products", undefined, "shoes")
    expect(match).toEqual({ id: "shoe-1", url: "https://ik.imagekit.io/lib/shoe.jpg" })
  })

  it("ignores an invalid category value and falls back to the 2-token-overlap rule", async () => {
    mockLimit.mockResolvedValue([
      { id: "watch-1", url: "https://ik.imagekit.io/lib/watch.jpg", category: "jewelry", tags: ["leather", "watch"], description: "Leather strap watch", rank: 0.5 },
    ])

    const match = await findLibraryImage("Classic Leather", "Products", undefined, "not-a-real-category")
    expect(match).toBeNull()
  })

  it("returns null when rank is below threshold", async () => {
    mockLimit.mockResolvedValue([
      {
        id: "img-low",
        url: "https://ik.imagekit.io/lib/low.jpg",
        category: "electronics",
        tags: ["quantum", "device"],
        description: "Quantum device",
        rank: MIN_RANK_THRESHOLD - 0.01,
      },
    ])

    const match = await findLibraryImage("Quantum Device", "Items")
    expect(match).toBeNull()
  })

  it("de-dupes across records using usedIds for variety", async () => {
    mockLimit.mockResolvedValue([
      { id: "img-1", url: "https://ik.imagekit.io/lib/shoe1.jpg", category: "shoes", tags: ["running", "shoes"], description: "Running shoe", rank: 0.7 },
      { id: "img-2", url: "https://ik.imagekit.io/lib/shoe2.jpg", category: "shoes", tags: ["running", "shoes"], description: "Running shoe", rank: 0.5 },
    ])

    const usedIds = new Set<string>()

    const match1 = await findLibraryImage("Running Shoes", "Products", usedIds)
    expect(match1).toEqual({ id: "img-1", url: "https://ik.imagekit.io/lib/shoe1.jpg" })
    expect(usedIds.has("img-1")).toBe(true)

    const match2 = await findLibraryImage("Running Shoes", "Products", usedIds)
    expect(match2).toEqual({ id: "img-2", url: "https://ik.imagekit.io/lib/shoe2.jpg" })
    expect(usedIds.has("img-2")).toBe(true)

    const match3 = await findLibraryImage("Running Shoes", "Products", usedIds)
    expect(match3).toBeNull()
  })

  it("returns null without querying DB if query has no valid tokens", async () => {
    const match = await findLibraryImage("the and in", "for")
    expect(match).toBeNull()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it("handles db errors gracefully and returns null without throwing", async () => {
    mockLimit.mockRejectedValue(new Error("Database connection lost"))

    const match = await findLibraryImage("Running Shoes", "Products")
    expect(match).toBeNull()
  })
})
