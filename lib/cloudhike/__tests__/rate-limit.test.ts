import { afterEach, describe, expect, it, vi } from "vitest"
import { overLimit } from "../rate-limit"

afterEach(() => vi.useRealTimers())

describe("overLimit", () => {
  it("allows up to the limit, then blocks, per key", () => {
    expect([1, 2, 3].map(() => overLimit("a", 3, 1000))).toEqual([false, false, false])
    expect(overLimit("a", 3, 1000)).toBe(true)
    expect(overLimit("b", 3, 1000)).toBe(false)
  })

  it("starts a fresh window once the old one has passed", () => {
    vi.useFakeTimers()
    expect([1, 2].map(() => overLimit("c", 1, 1000))).toEqual([false, true])
    vi.advanceTimersByTime(1001)
    expect(overLimit("c", 1, 1000)).toBe(false)
  })
})
