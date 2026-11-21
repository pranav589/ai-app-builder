import { beforeEach, describe, expect, it, vi } from "vitest"

const getBackend = vi.fn()
const runAppOp = vi.fn()

vi.mock("@/lib/cloudhike/app-backend", () => ({ getBackend: (id: string) => getBackend(id), readEnv: () => ({ DATABASE_URL: "x" }) }))
vi.mock("@/lib/cloudhike/app-ops", async (orig) => ({ ...(await orig<typeof import("@/lib/cloudhike/app-ops")>()), runAppOp: (...a: unknown[]) => runAppOp(...a) }))
vi.mock("@/db", () => ({
  projects: { id: "id", previewScreens: "previewScreens" },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ previewScreens: null }] }) }) }) },
}))

import { OPTIONS, POST } from "../route"

const ready = { projectId: "p1", status: "ready", envEnc: "enc", appKey: "the-app-key" }
let n = 0

function call(headers: Record<string, string>, body: unknown = { op: "version" }) {
  // A fresh project id per call keeps the rate limiter's counters apart.
  const id = `p${++n}`
  getBackend.mockResolvedValue({ ...ready, projectId: id })
  return POST(new Request("https://builder.example/api/app-runtime/x/data", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ projectId: id }),
  })
}

beforeEach(() => {
  getBackend.mockReset()
  runAppOp.mockReset().mockResolvedValue(42)
})

describe("POST /api/app-runtime/[projectId]/data", () => {
  it("runs the call for a request with the right app key, and allows any origin", async () => {
    const res = await call({ "x-app-key": "the-app-key", "x-app-session": "tok" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: 42 })
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    const ctx = runAppOp.mock.calls[0][0]
    expect(ctx).toMatchObject({ session: "tok", declaredOnly: true })
    expect(ctx.fileUrl("uploads/a.png")).toContain("/api/app-files/")
  })

  it.each([
    ["no key", {}],
    ["a wrong key", { "x-app-key": "nope" }],
    ["a key of the wrong length", { "x-app-key": "the-app-key-and-more" }],
  ])("refuses %s", async (_name, headers) => {
    const res = await call(headers)
    expect(res.status).toBe(403)
    expect(runAppOp).not.toHaveBeenCalled()
  })

  it("refuses when the app isn't connected, or has no key yet", async () => {
    getBackend.mockResolvedValue(null)
    const none = await POST(new Request("https://b/x", { method: "POST", headers: { "x-app-key": "the-app-key" }, body: "{}" }), { params: Promise.resolve({ projectId: "gone" }) })
    expect(none.status).toBe(403)

    getBackend.mockResolvedValue({ ...ready, appKey: null })
    const keyless = await POST(new Request("https://b/x", { method: "POST", headers: { "x-app-key": "" }, body: "{}" }), { params: Promise.resolve({ projectId: "keyless" }) })
    expect(keyless.status).toBe(403)
  })

  it("answers an unexpected failure with a generic 500, not its details", async () => {
    runAppOp.mockRejectedValue(new Error("password authentication failed for user postgres"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await call({ "x-app-key": "the-app-key" }, { op: "list", collection: "x" })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("postgres")
  })

  it("rate limits a caller that hammers one app", async () => {
    getBackend.mockResolvedValue(ready)
    const send = () => POST(new Request("https://b/x", { method: "POST", headers: { "x-app-key": "the-app-key", "x-forwarded-for": "9.9.9.9" }, body: "{}" }), { params: Promise.resolve({ projectId: "hammered" }) })
    let last = 200
    for (let i = 0; i < 241; i++) last = (await send()).status
    expect(last).toBe(429)
  })
})

describe("OPTIONS (CORS preflight)", () => {
  it("allows the app's headers from any origin", () => {
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-headers")).toContain("x-app-key")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })
})
