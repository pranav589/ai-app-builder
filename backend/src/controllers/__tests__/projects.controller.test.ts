import { describe, expect, it } from "vitest"
import request from "supertest"
import { app } from "../../index"

describe("Projects Controller - Auth Guard", () => {
  it("GET /api/projects rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/projects")
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: "Unauthorized" })
  })

  it("POST /api/projects rejects unauthenticated request", async () => {
    const res = await request(app).post("/api/projects").send({ prompt: "Hello" })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: "Unauthorized" })
  })

  it("PATCH /api/projects/:id rejects unauthenticated request", async () => {
    const res = await request(app).patch("/api/projects/proj-123").send({ name: "New Name" })
    expect(res.status).toBe(401)
  })

  it("DELETE /api/projects/:id rejects unauthenticated request", async () => {
    const res = await request(app).delete("/api/projects/proj-123")
    expect(res.status).toBe(401)
  })

  it("POST /api/projects/:id/duplicate rejects unauthenticated request", async () => {
    const res = await request(app).post("/api/projects/proj-123/duplicate")
    expect(res.status).toBe(401)
  })

  it("GET /api/projects/:id/workspace rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/projects/proj-123/workspace")
    expect(res.status).toBe(401)
  })

  it("GET /api/projects/:id/export/zip rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/projects/proj-123/export/zip")
    expect(res.status).toBe(401)
  })
})
