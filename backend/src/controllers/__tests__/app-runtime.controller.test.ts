import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const getBackend = vi.fn()
const runAppOp = vi.fn()
const runtime = vi.fn((_input: { fileUrl: (key: string) => string }) => ({ fake: "services" }))

vi.mock("../../services/app-backend/app-backend", async (orig) => ({
  ...(await orig<typeof import("../../services/app-backend/app-backend")>()),
  getBackend: (id: string) => getBackend(id),
  readEnv: () => ({ DATABASE_URL: "x" }),
}))
vi.mock("../../services/app-backend/app-ops", async (orig) => ({
  ...(await orig<typeof import("../../services/app-backend/app-ops")>()),
  runAppOp: (...a: unknown[]) => runAppOp(...a),
}))
// The route must hand the call to whichever provider the row names.
vi.mock("../../services/app-backend/registry", async (orig) => ({
  ...(await orig<typeof import("../../services/app-backend/registry")>()),
  providerFor: () => ({ runtime }),
}))
vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ previewScreens: null }] }) }) }) },
}))

const { app } = await import("../../index")

const ready = { projectId: "p1", provider: "cloudhike", status: "ready", envEnc: "enc", appKey: "the-app-key" }
let n = 0

function call(headers: Record<string, string>, body: object = { op: "version" }) {
  // A fresh project id per call keeps the rate limiter's counters apart.
  const id = `p${++n}`
  getBackend.mockResolvedValue({ ...ready, projectId: id })
  return request(app).post(`/api/app-runtime/${id}/data`).set(headers).send(body)
}

beforeEach(() => {
  getBackend.mockReset()
  runAppOp.mockReset().mockResolvedValue(42)
  runtime.mockClear()
})

describe("POST /api/app-runtime/:projectId/data", () => {
  it("runs the call for the right app key, and allows any origin", async () => {
    const res = await call({ "x-app-key": "the-app-key", "x-app-session": "tok" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ result: 42 })
    expect(res.headers["access-control-allow-origin"]).toBe("*")
    const ctx = runAppOp.mock.calls[0][0]
    expect(ctx).toMatchObject({ services: { fake: "services" }, session: "tok", declaredOnly: true })
    const input = runtime.mock.calls[0][0]
    expect(input.fileUrl("uploads/a.png")).toContain("/api/app-files/")
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
    const none = await request(app).post("/api/app-runtime/gone/data").set("x-app-key", "the-app-key").send({})
    expect(none.status).toBe(403)

    getBackend.mockResolvedValue({ ...ready, appKey: null })
    const keyless = await request(app).post("/api/app-runtime/keyless/data").set("x-app-key", "").send({})
    expect(keyless.status).toBe(403)
  })

  it("answers an unexpected failure with a generic 500, not its details", async () => {
    runAppOp.mockRejectedValue(new Error("password authentication failed for user postgres"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await call({ "x-app-key": "the-app-key" }, { op: "list", collection: "x" })
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain("postgres")
  })

  it("rate limits a caller that hammers one app", async () => {
    getBackend.mockResolvedValue(ready)
    const send = () => request(app).post("/api/app-runtime/hammered/data").set({ "x-app-key": "the-app-key", "x-forwarded-for": "9.9.9.9" }).send({})
    let last = 200
    for (let i = 0; i < 241; i++) last = (await send()).status
    expect(last).toBe(429)
  })
})

describe("OPTIONS /api/app-runtime/:projectId/data (CORS preflight)", () => {
  it("allows the app's headers from any origin", async () => {
    const res = await request(app).options("/api/app-runtime/p1/data").set("origin", "https://anywhere.example")
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-headers"]).toContain("x-app-key")
    expect(res.headers["access-control-allow-origin"]).toBe("*")
  })
})
