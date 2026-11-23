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

  it("preflights a REST route too (the catch-all covers more than /data)", async () => {
    const res = await request(app).options("/api/app-runtime/p1/collections/tasks").set("origin", "https://anywhere.example")
    expect(res.status).toBe(204)
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH")
  })
})

/** REST route -> op mapping. Same auth path as POST /data (handleRuntimeDataOp), so only
 * the mapping itself is exercised here -- the key/rate-limit checks are covered above. */
describe("REST routes", () => {
  const headers = { "x-app-key": "the-app-key", "x-app-session": "tok" }
  const ready2 = (id: string) => getBackend.mockResolvedValue({ ...ready, projectId: id })

  it("GET /collections/:name -> op list, answers with the bare result", async () => {
    ready2("rl1")
    runAppOp.mockResolvedValue([{ id: "t1" }])
    const res = await request(app).get("/api/app-runtime/rl1/collections/tasks").set(headers)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: "t1" }])
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "list", collection: "tasks" })
  })

  it("POST /collections/:name -> op insert, with the body as values", async () => {
    ready2("rl2")
    runAppOp.mockResolvedValue({ id: "t2", title: "New" })
    const res = await request(app).post("/api/app-runtime/rl2/collections/tasks").set(headers).send({ title: "New" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: "t2", title: "New" })
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "insert", collection: "tasks", values: { title: "New" } })
  })

  it("GET /collections/:name/:id -> op get", async () => {
    ready2("rl3")
    runAppOp.mockResolvedValue({ id: "t1" })
    await request(app).get("/api/app-runtime/rl3/collections/tasks/t1").set(headers)
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "get", collection: "tasks", id: "t1" })
  })

  it("PATCH /collections/:name/:id -> op update, with the body as patch", async () => {
    ready2("rl4")
    runAppOp.mockResolvedValue({ id: "t1", done: true })
    await request(app).patch("/api/app-runtime/rl4/collections/tasks/t1").set(headers).send({ done: true })
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "update", collection: "tasks", id: "t1", patch: { done: true } })
  })

  it("DELETE /collections/:name/:id -> op remove", async () => {
    ready2("rl5")
    runAppOp.mockResolvedValue(null)
    const res = await request(app).delete("/api/app-runtime/rl5/collections/tasks/t1").set(headers)
    expect(res.status).toBe(200)
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "remove", collection: "tasks", id: "t1" })
  })

  it("GET /settings and PUT /settings/:key -> settings and setSetting", async () => {
    ready2("rl6")
    runAppOp.mockResolvedValue({ theme: "dark" })
    await request(app).get("/api/app-runtime/rl6/settings").set(headers)
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "settings" })

    runAppOp.mockResolvedValue(null)
    await request(app).put("/api/app-runtime/rl6/settings/theme").set(headers).send({ value: "dark" })
    expect(runAppOp.mock.calls[1][1]).toMatchObject({ op: "setSetting", key: "theme", value: "dark" })
  })

  it("auth routes map to their auth.* ops", async () => {
    ready2("rl7")
    runAppOp.mockResolvedValue({ token: "tok", user: { id: "u1" } })
    await request(app).post("/api/app-runtime/rl7/auth/sign-in").set(headers).send({ email: "a@b.com", password: "pw" })
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "auth.signIn", email: "a@b.com", password: "pw" })

    runAppOp.mockResolvedValue(null)
    await request(app).post("/api/app-runtime/rl7/auth/sign-out").set(headers)
    expect(runAppOp.mock.calls[1][1]).toMatchObject({ op: "auth.signOut" })

    runAppOp.mockResolvedValue({ id: "u1" })
    await request(app).get("/api/app-runtime/rl7/auth/me").set(headers)
    expect(runAppOp.mock.calls[2][1]).toMatchObject({ op: "auth.current" })
  })

  it("POST /uploads -> op upload", async () => {
    ready2("rl8")
    runAppOp.mockResolvedValue({ url: "https://x/f.png" })
    await request(app).post("/api/app-runtime/rl8/uploads").set(headers).send({ dataUrl: "data:image/png;base64,AA==" })
    expect(runAppOp.mock.calls[0][1]).toMatchObject({ op: "upload", dataUrl: "data:image/png;base64,AA==" })
  })

  it("still refuses a REST route without the app key", async () => {
    ready2("rl9")
    const res = await request(app).get("/api/app-runtime/rl9/collections/tasks")
    expect(res.status).toBe(403)
    expect(runAppOp).not.toHaveBeenCalled()
  })
})
