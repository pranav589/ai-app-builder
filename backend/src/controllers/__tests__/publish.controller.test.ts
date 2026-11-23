import { describe, expect, it } from "vitest"
import request from "supertest"
import { app } from "../../index"

describe("Webhooks and Health", () => {
  it("GET /health returns 200 ok", async () => {
    const res = await request(app).get("/health")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it("POST /api/publish/webhook rejects without valid signature", async () => {
    const res = await request(app)
      .post("/api/publish/webhook")
      .set("Content-Type", "application/json")
      .send({ buildId: "fake-build" })
    expect(res.status).toBe(401)
  })

  it("POST /api/jobs/agent rejects without valid signature", async () => {
    const res = await request(app)
      .post("/api/jobs/agent")
      .set("Content-Type", "application/json")
      .send({ runId: "fake-run" })
    expect(res.status).toBe(401)
  })
})
