import { describe, expect, it } from "vitest"
import { findStockImage } from "@/lib/stock-images"

describe("findStockImage", () => {
  it("returns a stable Picsum url for a query", async () => {
    const result = await findStockImage("sneakers")
    expect(result).toMatch(/^https:\/\/picsum\.photos\/seed\/\d+\/1024\/1024$/)
  })

  it("returns the same url for the same query and variation", async () => {
    const a = await findStockImage("sneakers", 0)
    const b = await findStockImage("sneakers", 0)
    expect(a).toBe(b)
  })

  it("returns different urls for different variations of the same query", async () => {
    const a = await findStockImage("sneakers", 0)
    const b = await findStockImage("sneakers", 1)
    expect(a).not.toBe(b)
  })

  it("returns null for a blank query", async () => {
    const result = await findStockImage("   ")
    expect(result).toBeNull()
  })
})
