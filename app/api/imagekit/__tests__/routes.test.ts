import { describe, expect, it, vi } from "vitest"
import { POST as transformPost } from "../transform/route"
import { POST as generatePost } from "../generate/route"

// Mock current user
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user_test_123", email: "test@example.com" }),
  ServiceUnavailableError: class ServiceUnavailableError extends Error {},
}))

describe("ImageKit API Routes", () => {
  describe("POST /api/imagekit/transform", () => {
    it("returns 400 when imageUrl is missing", async () => {
      const req = new Request("http://localhost:3000/api/imagekit/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "remove background" }),
      })
      const res = await transformPost(req)
      expect(res.status).toBe(400)
    })

    it("successfully transforms an ImageKit image with a prompt", async () => {
      const req = new Request("http://localhost:3000/api/imagekit/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: "https://ik.imagekit.io/my_account/product.jpg",
          prompt: "remove background and add shadow",
        }),
      })
      const res = await transformPost(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.transformedUrl).toContain("e-removedotbg")
      expect(data.transformedUrl).toContain("e-dropshadow")
      expect(data.appliedTransformations).toEqual(["e-removedotbg", "e-dropshadow"])
    })
  })

  describe("POST /api/imagekit/generate", () => {
    it("returns 400 when prompt is empty", async () => {
      const req = new Request("http://localhost:3000/api/imagekit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "" }),
      })
      const res = await generatePost(req)
      expect(res.status).toBe(400)
    })

    it("generates an AI image and returns the ImageKit URL", async () => {
      const req = new Request("http://localhost:3000/api/imagekit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Cozy coffee cup with foam art",
          style: "photo",
        }),
      })
      const res = await generatePost(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(typeof data.imageUrl).toBe("string")
      expect(data.imageUrl.length).toBeGreaterThan(0)
    }, 15000)
  })
})
