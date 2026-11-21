import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const m = vi.hoisted(() => ({ getCurrentUser: vi.fn(), limit: vi.fn() }))

vi.mock("../../services/current-user", async (orig) => ({ ...(await orig<typeof import("../../services/current-user")>()), getCurrentUser: m.getCurrentUser }))
vi.mock("../../services/app-project/zip-export", async (orig) => ({
  ...(await orig<typeof import("../../services/app-project/zip-export")>()),
  buildExportFileMap: async () => ({ "a.ts": "", "b.ts": "" }),
}))
vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.limit }) }) }) },
}))

const { app } = await import("../../index")

const auth = { Authorization: "Bearer token" }

beforeEach(() => {
  m.limit.mockReset()
  m.getCurrentUser.mockResolvedValue({ id: "u1" })
})

describe("GET /api/projects/:id/github", () => {
  it("returns the repo link and a suggested commit message for the owner's project", async () => {
    const link = { repoOwner: "o", repoName: "r" }
    m.limit.mockResolvedValueOnce([{ name: "App", previewScreens: null }]).mockResolvedValueOnce([link])
    const res = await request(app).get("/api/projects/p1/github").set(auth)
    expect(res.status).toBe(200)
    expect(res.body.link).toEqual(link)
    expect(typeof res.body.suggestedMessage).toBe("string")
  })

  it("404s for a project the user doesn't own", async () => {
    m.limit.mockResolvedValueOnce([])
    const res = await request(app).get("/api/projects/p1/github").set(auth)
    expect(res.status).toBe(404)
  })
})
