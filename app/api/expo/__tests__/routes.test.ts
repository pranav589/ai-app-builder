import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetCurrentUser, mockGetConnection, mockSaveToken, mockForgetConnection } = vi.hoisted(() => {
  const mockGetCurrentUser = vi.fn()
  const mockGetConnection = vi.fn()
  const mockSaveToken = vi.fn()
  const mockForgetConnection = vi.fn().mockResolvedValue(undefined)
  return { mockGetCurrentUser, mockGetConnection, mockSaveToken, mockForgetConnection }
})

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock("@/lib/publish/expo-connect", () => ({
  getConnection: mockGetConnection,
  saveToken: mockSaveToken,
  forgetConnection: mockForgetConnection,
  ExpoConnectError: class ExpoConnectError extends Error {
    constructor(msg: string, readonly code: string) {
      super(msg)
    }
  },
}))

const { GET: getStatus } = await import("../status/route")
const { POST: postConnect } = await import("../connect/route")
const { POST: postDisconnect } = await import("../disconnect/route")

describe("Expo Connect API routes", () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockGetConnection.mockReset()
    mockSaveToken.mockReset()
    mockForgetConnection.mockClear()
  })

  describe("GET /api/expo/status", () => {
    it("returns connected: false when user is not signed in", async () => {
      mockGetCurrentUser.mockRejectedValue(new Error("Unauthorized"))
      const res = await getStatus()
      const json = await res.json()
      expect(json).toEqual({ connected: false })
    })

    it("returns connected: true and username when connection exists", async () => {
      mockGetCurrentUser.mockResolvedValue({ id: "user_1" })
      mockGetConnection.mockResolvedValue({ status: "active", expoUsername: "expo_user" })
      const res = await getStatus()
      const json = await res.json()
      expect(json).toEqual({ connected: true, username: "expo_user" })
    })
  })

  describe("POST /api/expo/connect", () => {
    it("rejects non-same-origin requests", async () => {
      const req = new Request("http://localhost:3000/api/expo/connect", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      })
      const res = await postConnect(req)
      expect(res.status).toBe(400)
    })

    it("saves valid token and returns username", async () => {
      mockGetCurrentUser.mockResolvedValue({ id: "user_1" })
      mockSaveToken.mockResolvedValue({ username: "expo_dev" })

      const req = new Request("http://localhost:3000/api/expo/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ token: "expo_pat_valid" }),
      })
      const res = await postConnect(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toEqual({ ok: true, username: "expo_dev" })
      expect(mockSaveToken).toHaveBeenCalledWith("user_1", "expo_pat_valid")
    })
  })

  describe("POST /api/expo/disconnect", () => {
    it("disconnects the user account", async () => {
      mockGetCurrentUser.mockResolvedValue({ id: "user_1" })

      const req = new Request("http://localhost:3000/api/expo/disconnect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
      })
      const res = await postDisconnect(req)
      expect(res.status).toBe(200)
      expect(mockForgetConnection).toHaveBeenCalledWith("user_1")
    })
  })
})
