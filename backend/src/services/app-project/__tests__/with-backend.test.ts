import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const lanIPv4Stable = vi.fn<() => Promise<string | null>>()
const getBackend = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/device/lan", () => ({ lanIPv4Stable: () => lanIPv4Stable() }))
vi.mock("@/lib/app-backend/app-backend", () => ({
  getBackend: (id: string) => getBackend(id),
  ensureAppKey: async () => "key-1",
}))

import { withBackend } from "../with-backend"

const ready = { projectId: "p1", provider: "cloudhike", status: "ready", envEnc: "enc", appKey: "key-1" }
const configOf = (files: Record<string, string>) => files["lib/backend/config.ts"] ?? ""

let savedUrl: string | undefined
beforeEach(() => {
  savedUrl = process.env.NEXT_PUBLIC_APP_URL
  getBackend.mockReset().mockResolvedValue(ready)
  lanIPv4Stable.mockReset().mockResolvedValue("192.168.1.20")
})
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = savedUrl
})

describe("withBackend", () => {
  // Every output (QR build, Metro lane, ZIP, GitHub, APK) goes through here; a localhost URL baked
  // into any of them is unreachable from a phone, which once shipped from two separate paths.
  it("points a dev build at this machine's LAN address instead of localhost", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000/"
    const r = await withBackend("p1", {})
    expect(configOf(r.files)).toContain('"http://192.168.1.20:3000/api/app-runtime/p1/data"')
    expect(configOf(r.files)).not.toContain("localhost")
  })

  it("leaves a public URL alone", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://builder.example.com"
    const r = await withBackend("p1", {})
    expect(configOf(r.files)).toContain('"https://builder.example.com/api/app-runtime/p1/data"')
    expect(lanIPv4Stable).not.toHaveBeenCalled()
  })

  it("falls back to localhost, with a warning, when there's no LAN address at all", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"
    lanIPv4Stable.mockResolvedValue(null)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await withBackend("p1", {})
    expect(configOf(r.files)).toContain('"http://localhost:3000/api/app-runtime/p1/data"')
    expect(warn).toHaveBeenCalled()
  })

  it("keeps the on-device backend when no provider is connected", async () => {
    getBackend.mockResolvedValue({ ...ready, status: "provisioning" })
    const files = { "lib/backend/index.ts": "local" }
    const r = await withBackend("p1", files)
    expect(r).toEqual({ files, provider: null })
  })
})
