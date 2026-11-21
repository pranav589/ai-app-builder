import { describe, expect, it, vi } from "vitest"
import request from "supertest"
import { app } from "../../index"

describe("Auth Controller", () => {
  it("GET /api/auth/session returns null user when unauthenticated", async () => {
    const res = await request(app).get("/api/auth/session")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: null })
  })

  it("POST /api/auth/sign-in returns 400 for empty body", async () => {
    const res = await request(app).post("/api/auth/sign-in").send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it("POST /api/auth/sign-up returns 400 for empty body", async () => {
    const res = await request(app).post("/api/auth/sign-up").send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it("POST /api/auth/sign-out clears cookie and returns ok", async () => {
    const res = await request(app).post("/api/auth/sign-out").send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it("POST /api/auth/social returns 400 for missing token", async () => {
    const res = await request(app).post("/api/auth/social").send({})
    expect(res.status).toBe(400)
  })
})
