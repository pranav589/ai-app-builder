import { describe, expect, it } from "vitest"
import { deterministicImageId, parseManifest } from "../seed-image-library"

describe("parseManifest", () => {
  it("parses valid array of manifest items", () => {
    const raw = [
      {
        file: "sneaker-white.jpg",
        category: "Shoes",
        description: "Classic low-top white sneakers",
        tags: ["sneakers", "casual", "white"],
      },
      {
        file: "runner-black.jpg",
        category: "Shoes",
        description: "High performance running shoes",
        tags: "runner, athletic, black",
      },
    ]

    const parsed = parseManifest(raw)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      file: "sneaker-white.jpg",
      category: "Shoes",
      description: "Classic low-top white sneakers",
      tags: ["sneakers", "casual", "white"],
      imagekit_file_id: undefined,
    })
    expect(parsed[1].tags).toEqual(["runner", "athletic", "black"])
  })

  it("parses valid object with images array property", () => {
    const raw = {
      images: [
        {
          file: "coffee-mug.jpg",
          category: "Kitchen",
          description: "Ceramic coffee mug",
          tags: ["coffee", "cup"],
        },
      ],
    }

    const parsed = parseManifest(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].file).toBe("coffee-mug.jpg")
  })

  it("parses valid JSON string", () => {
    const jsonStr = JSON.stringify([
      {
        file: "watch.png",
        category: "Accessories",
      },
    ])

    const parsed = parseManifest(jsonStr)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].file).toBe("watch.png")
    expect(parsed[0].description).toBe("")
    expect(parsed[0].tags).toEqual([])
  })

  it("throws on invalid JSON string", () => {
    expect(() => parseManifest("not json")).toThrow(/Invalid manifest JSON/)
  })

  it("throws when root is neither an array nor has an images array", () => {
    expect(() => parseManifest({ random: 123 })).toThrow(/Manifest must be a JSON array/)
    expect(() => parseManifest(null)).toThrow(/Manifest must be a JSON array/)
  })

  it("throws when item is missing file or category", () => {
    expect(() => parseManifest([{ file: "test.jpg" }])).toThrow(/missing a valid 'category'/)
    expect(() => parseManifest([{ category: "Shoes" }])).toThrow(/missing a valid 'file'/)
    expect(() => parseManifest([null])).toThrow(/not an object/)
  })
})

describe("deterministicImageId", () => {
  it("generates stable id for same file and category", () => {
    const id1 = deterministicImageId("sneakers/1.jpg", "Shoes")
    const id2 = deterministicImageId("sneakers/1.jpg", "shoes")
    const id3 = deterministicImageId("sneakers/2.jpg", "shoes")

    expect(id1).toBe(id2)
    expect(id1.startsWith("img_")).toBe(true)
    expect(id1).not.toBe(id3)
  })
})
