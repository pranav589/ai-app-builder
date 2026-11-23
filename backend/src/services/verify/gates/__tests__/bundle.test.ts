import { afterEach, describe, expect, it, vi } from "vitest"
import { bundleGate } from "@/lib/verify/gates/bundle"
import { METRO_PORT } from "@/lib/device/export"

describe("bundleGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("passes when Metro returns 200 for both platforms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const r = await bundleGate()
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain(`:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=ios&dev=true`)
    expect(fetchMock.mock.calls[1][0]).toContain("platform=android")
  })

  it("fails with a bundle diagnostic when Metro returns an error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("SyntaxError: Unexpected token", { status: 500 }))
    )

    const r = await bundleGate()
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toHaveLength(2)
    expect(r.diagnostics[0]).toMatchObject({ gate: "bundle", code: "http_500", severity: "error" })
    expect(r.diagnostics[0].message).toContain("Unexpected token")
  })

  it("fails with a readable message when Metro isn't running at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"))
    )

    const r = await bundleGate()
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0].code).toBe("metro_unreachable")
    expect(r.diagnostics[0].message).toContain("npm run device")
  })
})
