import { describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../services/current-user", async (orig) => ({
  ...(await orig<typeof import("../../services/current-user")>()),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user_test_123", email: "test@example.com" }),
}))

const { app } = await import("../../index")

const auth = { Authorization: "Bearer token" }

describe("ImageKit API", () => {
  it("POST /api/imagekit/transform returns 400 when imageUrl is missing", async () => {
    const res = await request(app).post("/api/imagekit/transform").set(auth).send({ prompt: "remove background" })
    expect(res.status).toBe(400)
  })

  it("POST /api/imagekit/transform applies the prompt's transformations", async () => {
    const res = await request(app)
      .post("/api/imagekit/transform")
      .set(auth)
      .send({ imageUrl: "https://ik.imagekit.io/my_account/product.jpg", prompt: "remove background and add shadow" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.transformedUrl).toContain("e-removedotbg")
    expect(res.body.transformedUrl).toContain("e-dropshadow")
    expect(res.body.appliedTransformations).toEqual(["e-removedotbg", "e-dropshadow"])
  })

  it("POST /api/imagekit/generate returns 400 when the prompt is empty", async () => {
    const res = await request(app).post("/api/imagekit/generate").set(auth).send({ prompt: "" })
    expect(res.status).toBe(400)
  })

  it("POST /api/imagekit/generate returns an ImageKit URL", async () => {
    const res = await request(app).post("/api/imagekit/generate").set(auth).send({ prompt: "Cozy coffee cup with foam art", style: "photo" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.imageUrl).toBe("string")
    expect(res.body.imageUrl.length).toBeGreaterThan(0)
  }, 15000)
})
