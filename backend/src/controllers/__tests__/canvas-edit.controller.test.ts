import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  handleCanvasEdits: vi.fn(),
}))

vi.mock("../../services/current-user", async (orig) => ({ ...(await orig<typeof import("../../services/current-user")>()), getCurrentUser: m.getCurrentUser }))
vi.mock("../../services/agent/agent.service", async (orig) => ({
  ...(await orig<typeof import("../../services/agent/agent.service")>()),
  handleCanvasEdits: m.handleCanvasEdits,
}))

const { app } = await import("../../index")

const send = (body: unknown) =>
  request(app).post("/api/projects/p1/canvas-edit").set({ Authorization: "Bearer token" }).set("content-type", "application/json").send(body as object)

beforeEach(() => {
  vi.clearAllMocks()
  m.getCurrentUser.mockResolvedValue({ id: "u1" })
  m.handleCanvasEdits.mockResolvedValue({ status: 200, body: { files: {}, version: 2, failed: [] } })
})

describe("POST /api/projects/:id/canvas-edit", () => {
  it("passes every edit in the batch to the service, keeping only editable style keys", async () => {
    const res = await send({
      edits: [
        { eid: "app/home.tsx:4:Text", text: "Hi", from: "Hello" },
        { eid: "app/home.tsx:9:View", style: { backgroundColor: "#fff", notAStyle: "x" } },
      ],
    })
    expect(res.status).toBe(200)
    expect(m.handleCanvasEdits).toHaveBeenCalledWith(
      "u1",
      "p1",
      [
        { eid: "app/home.tsx:4:Text", text: "Hi", from: "Hello", style: undefined, imageSrc: undefined },
        { eid: "app/home.tsx:9:View", text: undefined, from: undefined, style: { backgroundColor: "#fff" }, imageSrc: undefined },
      ],
      expect.any(AbortSignal)
    )
  })

  it.each([
    ["a single edit instead of a batch", { eid: "app/home.tsx:4:Text", text: "Hi" }],
    ["an empty batch", { edits: [] }],
    ["an edit without an eid", { edits: [{ text: "Hi" }] }],
    ["an edit that changes nothing", { edits: [{ eid: "app/home.tsx:4:Text", style: { notAStyle: "x" } }] }],
    ["too many edits", { edits: Array.from({ length: 101 }, (_, i) => ({ eid: `app/home.tsx:${i}:Text`, text: "x" })) }],
  ])("400s for %s", async (_, body) => {
    expect((await send(body)).status).toBe(400)
    expect(m.handleCanvasEdits).not.toHaveBeenCalled()
  })

  it("passes the service's status and body through", async () => {
    m.handleCanvasEdits.mockResolvedValue({ status: 422, body: { error: "Nothing to change.", failed: [] } })
    const res = await send({ edits: [{ eid: "app/home.tsx:4:Text", text: "Hi" }] })
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: "Nothing to change.", failed: [] })
  })
})
