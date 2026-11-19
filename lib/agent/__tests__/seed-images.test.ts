import { describe, expect, it, vi, beforeEach } from "vitest"
import type { DataModel } from "@/lib/app-runtime/data-model"

const { findStockImage, findLibraryImage, recordMiss } = vi.hoisted(() => ({
  findStockImage: vi.fn(),
  findLibraryImage: vi.fn(),
  recordMiss: vi.fn(),
}))

vi.mock("@/lib/stock-images", () => ({ findStockImage }))
vi.mock("@/lib/image-library", () => ({ findLibraryImage, recordMiss }))

const { fillSeedImages } = await import("@/lib/agent/seed-images")

const baseData = (): DataModel => ({
  hash: "h",
  settings: {},
  user: { name: "Alex", email: "alex@example.com" },
  collections: [
    {
      name: "products",
      label: "Products",
      category: "shoes",
      fields: [
        { name: "name", type: "string" },
        { name: "photo", type: "image" },
      ],
      seed: [
        { id: "p1", name: "Runner Pro Low", photo: "" },
        { id: "p2", name: "Trail Max", photo: "" },
        { id: "p3", name: "Already set", photo: "https://images.pexels.com/x/already.jpg" },
      ],
    },
  ],
})

beforeEach(() => {
  findStockImage.mockReset()
  findLibraryImage.mockReset()
  recordMiss.mockReset()
})

describe("fillSeedImages", () => {
  it("uses image library when a match is found", async () => {
    findLibraryImage.mockImplementation(async (subject: string) => ({
      id: `lib_${subject}`,
      url: `https://ik.imagekit.io/library/${encodeURIComponent(subject)}.jpg`,
    }))

    const out = await fillSeedImages(baseData())
    const seed = out.collections[0].seed
    expect(seed[0].photo).toBe("https://ik.imagekit.io/library/Runner%20Pro%20Low.jpg")
    expect(seed[1].photo).toBe("https://ik.imagekit.io/library/Trail%20Max.jpg")
    expect(seed[2].photo).toBe("https://images.pexels.com/x/already.jpg")
    expect(findLibraryImage).toHaveBeenCalledTimes(2)
    expect(findLibraryImage).toHaveBeenCalledWith("Runner Pro Low", "Products", expect.anything(), "shoes")
    expect(findStockImage).not.toHaveBeenCalled()
    expect(recordMiss).not.toHaveBeenCalled()
  })

  it("records a miss and falls back to stock image when library returns null", async () => {
    findLibraryImage.mockResolvedValue(null)
    findStockImage.mockImplementation(async (query: string) => `https://picsum.photos/${encodeURIComponent(query)}.jpg`)

    const out = await fillSeedImages(baseData())
    const seed = out.collections[0].seed
    expect(seed[0].photo).toBe("https://picsum.photos/Runner%20Pro%20Low%20Products.jpg")
    expect(seed[1].photo).toBe("https://picsum.photos/Trail%20Max%20Products.jpg")
    expect(recordMiss).toHaveBeenCalledTimes(2)
    expect(recordMiss).toHaveBeenCalledWith("Runner Pro Low Products", "Products", "Runner Pro Low")
    expect(recordMiss).toHaveBeenCalledWith("Trail Max Products", "Products", "Trail Max")
    expect(findStockImage).toHaveBeenCalledTimes(2)
  })

  it("still falls back to stock image if recordMiss rejects", async () => {
    findLibraryImage.mockResolvedValue(null)
    recordMiss.mockRejectedValue(new Error("db down"))
    findStockImage.mockResolvedValue("https://picsum.photos/fallback.jpg")

    const out = await fillSeedImages(baseData())
    const seed = out.collections[0].seed
    expect(seed[0].photo).toBe("https://picsum.photos/fallback.jpg")
    expect(seed[1].photo).toBe("https://picsum.photos/fallback.jpg")
    expect(findStockImage).toHaveBeenCalledTimes(2)
  })

  it("leaves a field blank when both library and stock search return nothing", async () => {
    findLibraryImage.mockResolvedValue(null)
    findStockImage.mockResolvedValue(null)

    const out = await fillSeedImages(baseData())
    expect(out.collections[0].seed[0].photo).toBe("")
    expect(out.collections[0].seed[1].photo).toBe("")
  })

  it("leaves a field blank when searches throw, without failing the build", async () => {
    findLibraryImage.mockRejectedValue(new Error("library boom"))
    findStockImage.mockRejectedValue(new Error("stock boom"))

    const out = await fillSeedImages(baseData())
    expect(out.collections[0].seed[0].photo).toBe("")
    expect(out.collections[0].seed[1].photo).toBe("")
  })

  it("skips collections with no image field entirely", async () => {
    const data: DataModel = {
      ...baseData(),
      collections: [{ name: "tags", label: "Tags", fields: [{ name: "name", type: "string" }], seed: [{ id: "t1", name: "Sale" }] }],
    }
    const out = await fillSeedImages(data)
    expect(out).toBe(data)
    expect(findLibraryImage).not.toHaveBeenCalled()
    expect(findStockImage).not.toHaveBeenCalled()
    expect(recordMiss).not.toHaveBeenCalled()
  })
})
