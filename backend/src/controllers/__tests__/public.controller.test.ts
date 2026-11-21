import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../services/projects/projects.service", () => ({
  listPublicProjects: vi.fn(async () => [
    {
      id: "p1",
      name: "App 1",
      tagline: null,
      themeColor: null,
      previewScreens: { screens: [] },
      publicSlug: "app-1",
    },
  ]),
  getPublicProjectBySlug: vi.fn(async (slug: string) => {
    if (slug === "demo-app") {
      return {
        id: "p1",
        name: "Demo App",
        themeColor: "#000",
        previewScreens: { screens: [] },
      }
    }
    return null
  }),
}))

import { app } from "../../index"

describe("Public Controller", () => {
  it("GET /api/public/projects responds without authentication", async () => {
    const res = await request(app).get("/api/public/projects")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.projects)).toBe(true)
    expect(res.body.projects.length).toBe(1)
  })

  it("GET /api/public/projects/:slug returns 404 for unknown slug", async () => {
    const res = await request(app).get("/api/public/projects/non-existent-slug-xyz")
    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
  })

  it("GET /api/public/projects/:slug returns project for known slug", async () => {
    const res = await request(app).get("/api/public/projects/demo-app")
    expect(res.status).toBe(200)
    expect(res.body.name).toBe("Demo App")
  })
})
