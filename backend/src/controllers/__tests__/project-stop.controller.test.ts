import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getProjectForUser: vi.fn(),
  getBuild: vi.fn(),
  cancelActiveBuild: vi.fn(),
  cancelWebDeployment: vi.fn(),
  cancelDeviceBuild: vi.fn(),
  limit: vi.fn(),
}))

vi.mock("../../services/current-user", async (orig) => ({ ...(await orig<typeof import("../../services/current-user")>()), getCurrentUser: m.getCurrentUser }))
vi.mock("@/db/projects", async (orig) => ({ ...(await orig<typeof import("@/db/projects")>()), getProjectForUser: m.getProjectForUser }))
vi.mock("../../services/publish/builds", async (orig) => ({
  ...(await orig<typeof import("../../services/publish/builds")>()),
  getBuild: m.getBuild,
  cancelActiveBuild: m.cancelActiveBuild,
}))
vi.mock("../../services/publish/web-deploy", async (orig) => ({
  ...(await orig<typeof import("../../services/publish/web-deploy")>()),
  cancelWebDeployment: m.cancelWebDeployment,
}))
vi.mock("../../services/device/build", async (orig) => ({ ...(await orig<typeof import("../../services/device/build")>()), cancelDeviceBuild: m.cancelDeviceBuild }))
vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.limit }) }) }) },
}))

const { app } = await import("../../index")

const auth = { Authorization: "Bearer token" }
const json = "application/json"

beforeEach(() => {
  vi.clearAllMocks()
  m.limit.mockReset()
  m.getCurrentUser.mockResolvedValue({ id: "u1" })
  m.getProjectForUser.mockResolvedValue({ id: "p1" })
})

describe("POST /api/projects/:id/builds/:buildId/stop", () => {
  const stop = (buildId = "b1") => request(app).post(`/api/projects/p1/builds/${buildId}/stop`).set(auth).set("content-type", json).send({})

  it("fails an in-flight build", async () => {
    m.getBuild.mockResolvedValue({ id: "b1", projectId: "p1" })
    m.cancelActiveBuild.mockResolvedValue(true)
    const res = await stop()
    expect(res.status).toBe(200)
    expect(m.cancelActiveBuild).toHaveBeenCalledWith("b1", "Stopped by you.")
  })

  it("404s for a build that belongs to another project", async () => {
    m.getBuild.mockResolvedValue({ id: "b1", projectId: "other" })
    expect((await stop()).status).toBe(404)
    expect(m.cancelActiveBuild).not.toHaveBeenCalled()
  })

  it("409s when the build already finished", async () => {
    m.getBuild.mockResolvedValue({ id: "b1", projectId: "p1" })
    m.cancelActiveBuild.mockResolvedValue(false)
    expect((await stop()).status).toBe(409)
  })

  it("404s when the user does not own the project", async () => {
    m.getProjectForUser.mockResolvedValue(null)
    expect((await stop()).status).toBe(404)
    expect(m.cancelActiveBuild).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/projects/:id/publish/web", () => {
  const stop = () => request(app).delete("/api/projects/p1/publish/web").set(auth)

  it("fails the in-flight deployment", async () => {
    m.cancelWebDeployment.mockResolvedValue(true)
    expect((await stop()).status).toBe(200)
    expect(m.cancelWebDeployment).toHaveBeenCalledWith("p1", "Stopped by you.")
  })

  it("409s when nothing is running", async () => {
    m.cancelWebDeployment.mockResolvedValue(false)
    expect((await stop()).status).toBe(409)
  })
})

describe("DELETE /api/projects/:id/device-build", () => {
  const stop = () => request(app).delete("/api/projects/p1/device-build").set(auth)

  it("stops the build and answers with the new status", async () => {
    m.cancelDeviceBuild.mockResolvedValue(true)
    // Ownership check, then the status lookup reads the project and the build row.
    m.limit
      .mockResolvedValueOnce([{ id: "p1" }])
      .mockResolvedValueOnce([{ currentVersion: 1 }])
      .mockResolvedValueOnce([{ status: "failed", error: "Stopped by you.", builtVersion: null }])
    const res = await stop()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: "failed", error: "Stopped by you." })
  })

  it("409s when no build is running", async () => {
    m.cancelDeviceBuild.mockResolvedValue(false)
    m.limit.mockResolvedValueOnce([{ id: "p1" }])
    expect((await stop()).status).toBe(409)
  })

  it("404s for a project the user does not own", async () => {
    m.limit.mockResolvedValueOnce([])
    expect((await stop()).status).toBe(404)
    expect(m.cancelDeviceBuild).not.toHaveBeenCalled()
  })
})
