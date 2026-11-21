import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const m = vi.hoisted(() => ({ getCurrentUser: vi.fn(), limit: vi.fn(), startDeviceBuild: vi.fn() }))

vi.mock("../../services/current-user", async (orig) => ({ ...(await orig<typeof import("../../services/current-user")>()), getCurrentUser: m.getCurrentUser }))
vi.mock("../../services/device/build", async (orig) => ({ ...(await orig<typeof import("../../services/device/build")>()), startDeviceBuild: m.startDeviceBuild }))
vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.limit }) }) }) },
}))

const { app } = await import("../../index")

const auth = { Authorization: "Bearer token" }
const project = { id: "p1", name: "App", currentVersion: 3, previewScreens: null }

beforeEach(() => {
  m.limit.mockReset()
  m.startDeviceBuild.mockReset().mockResolvedValue(undefined)
  m.getCurrentUser.mockResolvedValue({ id: "u1" })
})

describe("/api/projects/:id/device-build", () => {
  it("POST answers with the build's status, the same shape GET returns, so the QR dialog can show it at once", async () => {
    // triggerDeviceBuild reads the project, then the status lookup reads the project and the build row.
    m.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([project]).mockResolvedValueOnce([{ status: "building", error: null, builtVersion: null }])
    const res = await request(app).post("/api/projects/p1/device-build").set(auth).send()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: "building", stale: false, manifestUrl: null })
    expect(m.startDeviceBuild).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", userId: "u1", currentVersion: 3 }))
  })

  it("GET reports status none when no build exists yet", async () => {
    m.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce([])
    const res = await request(app).get("/api/projects/p1/device-build").set(auth)
    expect(res.body).toEqual({ status: "none" })
  })
})
