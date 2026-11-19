import { describe, expect, it } from "vitest"
import { IMAGE_LIBRARY_CATEGORIES, isImageLibraryCategory } from "@/lib/image-library/categories"

describe("isImageLibraryCategory", () => {
  it("accepts every known category", () => {
    for (const c of IMAGE_LIBRARY_CATEGORIES) expect(isImageLibraryCategory(c)).toBe(true)
  })

  it("rejects unknown strings, non-strings, and undefined", () => {
    expect(isImageLibraryCategory("sneakers")).toBe(false)
    expect(isImageLibraryCategory("")).toBe(false)
    expect(isImageLibraryCategory(42)).toBe(false)
    expect(isImageLibraryCategory(undefined)).toBe(false)
  })
})
