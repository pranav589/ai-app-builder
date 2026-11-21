import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getConnection: vi.fn(),
  saveToken: vi.fn(),
  forgetConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../services/current-user", async (orig) => ({ ...(await orig<typeof import("../../services/current-user")>()), getCurrentUser: m.getCurrentUser }))
vi.mock("../../services/publish/expo-connect", async (orig) => ({
  ...(await orig<typeof import("../../services/publish/expo-connect")>()),
  getConnection: m.getConnection,
  saveToken: m.saveToken,
  forgetConnection: m.forgetConnection,
}))

const { app } = await import("../../index")

const auth = { Authorization: "Bearer token" }

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  m.getCurrentUser.mockResolvedValue({ id: "user_1" })
})

describe("Expo Connect API", () => {
  it("GET /api/expo/status reports connected: false when signed out", async () => {
    const res = await request(app).get("/api/expo/status")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ connected: false })
  })

  it("GET /api/expo/status reports the username when a connection exists", async () => {
    m.getConnection.mockResolvedValue({ status: "active", expoUsername: "expo_user" })
    const res = await request(app).get("/api/expo/status").set(auth)
    expect(res.body).toEqual({ connected: true, username: "expo_user" })
  })

  it("POST /api/expo/connect rejects cross-site requests", async () => {
    // Outside production every origin is trusted, to allow local dev across ports.
    vi.stubEnv("NODE_ENV", "production")
    const res = await request(app).post("/api/expo/connect").set(auth).set("origin", "https://evil.example").send({ token: "expo_pat_valid" })
    expect(res.status).toBe(400)
    expect(m.saveToken).not.toHaveBeenCalled()
  })

  it("POST /api/expo/connect saves a valid token and returns the username", async () => {
    m.saveToken.mockResolvedValue({ username: "expo_dev" })
    const res = await request(app).post("/api/expo/connect").set(auth).send({ token: "expo_pat_valid" })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, username: "expo_dev" })
    expect(m.saveToken).toHaveBeenCalledWith("user_1", "expo_pat_valid")
  })

  it("POST /api/expo/disconnect forgets the user's connection", async () => {
    const res = await request(app).post("/api/expo/disconnect").set(auth).send({})
    expect(res.status).toBe(200)
    expect(m.forgetConnection).toHaveBeenCalledWith("user_1")
  })
})
