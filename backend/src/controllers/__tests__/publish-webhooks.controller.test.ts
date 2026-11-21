import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"
import { createPublishWebhookSignature } from "../../services/publish/webhook-auth"

const { mockDbSelect, mockGetBuild, mockMarkReady, mockMarkFailed, mockUpdateEasProject, web } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockGetBuild: vi.fn(),
  mockMarkReady: vi.fn().mockResolvedValue(undefined),
  mockMarkFailed: vi.fn().mockResolvedValue(undefined),
  mockUpdateEasProject: vi.fn().mockResolvedValue(undefined),
  web: {
    markWebReady: vi.fn().mockResolvedValue(undefined),
    markWebFailed: vi.fn().mockResolvedValue(undefined),
    markWebDeploying: vi.fn().mockResolvedValue(undefined),
    markWebBuilding: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), db: { select: mockDbSelect } }))
vi.mock("../../services/publish/builds", async (orig) => ({
  ...(await orig<typeof import("../../services/publish/builds")>()),
  getBuild: mockGetBuild,
  markReady: mockMarkReady,
  markFailed: mockMarkFailed,
}))
vi.mock("../../services/publish/web-deploy", async (orig) => ({ ...(await orig<typeof import("../../services/publish/web-deploy")>()), ...web }))
vi.mock("../../services/publish/app-identity", async (orig) => ({
  ...(await orig<typeof import("../../services/publish/app-identity")>()),
  updateEasProject: mockUpdateEasProject,
}))

const { app } = await import("../../index")

const secret = "test_webhook_secret_key_12345678"
const originalSecret = process.env.PUBLISH_WEBHOOK_SECRET

function post(path: string, payload: unknown) {
  const body = JSON.stringify(payload)
  return request(app).post(path).set("x-publish-signature", createPublishWebhookSignature(body, secret)).set("content-type", "application/json").send(body)
}

function mockRunLookup(run: { id: string; status: string } | null) {
  mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => (run ? [run] : []) }) }) })
}

beforeEach(() => {
  process.env.PUBLISH_WEBHOOK_SECRET = secret
  vi.clearAllMocks()
})

afterEach(() => {
  process.env.PUBLISH_WEBHOOK_SECRET = originalSecret
})

describe("POST /api/publish/webhook", () => {
  it("returns 401 when the signature is invalid", async () => {
    const res = await request(app).post("/api/publish/webhook").set("x-publish-signature", "invalid").set("content-type", "application/json").send({ buildId: "b1" })
    expect(res.status).toBe(401)
  })

  it("returns 404 when the build does not exist", async () => {
    mockGetBuild.mockResolvedValue(null)
    expect((await post("/api/publish/webhook", { buildId: "b_missing" })).status).toBe(404)
  })

  it("marks a successful build ready and records the EAS project", async () => {
    mockGetBuild.mockResolvedValue({ id: "b1", projectId: "p1", status: "building" })
    const res = await post("/api/publish/webhook", {
      buildId: "b1",
      status: "ready",
      easBuildId: "eas-123",
      artifactUrl: "https://expo.dev/artifacts/test.apk",
      workflowRunUrl: "https://github.com/runs/1",
      easProjectId: "eas-proj-1",
      expoOwner: "expo-user",
    })
    expect(res.status).toBe(200)
    expect(mockMarkReady).toHaveBeenCalledWith("b1", {
      artifactUrl: "https://expo.dev/artifacts/test.apk",
      easBuildId: "eas-123",
      workflowRunUrl: "https://github.com/runs/1",
    })
    expect(mockUpdateEasProject).toHaveBeenCalledWith("p1", { easProjectId: "eas-proj-1", expoOwner: "expo-user" })
  })

  it("marks a build failed with needsIosCredentials=1 when credentials are missing", async () => {
    mockGetBuild.mockResolvedValue({ id: "b2", projectId: "p1", status: "building" })
    const res = await post("/api/publish/webhook", { buildId: "b2", status: "failed", error: "Apple Developer credentials missing", needsIosCredentials: 1 })
    expect(res.status).toBe(200)
    expect(mockMarkFailed).toHaveBeenCalledWith("b2", expect.objectContaining({ error: "Apple Developer credentials missing", needsIosCredentials: 1 }))
  })

  it("answers 200 without re-processing a build that is already terminal", async () => {
    mockGetBuild.mockResolvedValue({ id: "b3", projectId: "p1", status: "ready" })
    const res = await post("/api/publish/webhook", { buildId: "b3", status: "ready", artifactUrl: "https://expo.dev/artifacts/test.apk" })
    expect(res.status).toBe(200)
    expect(mockMarkReady).not.toHaveBeenCalled()
  })
})

describe("POST /api/publish/web-webhook", () => {
  it("returns 401 when the signature is invalid", async () => {
    const res = await request(app).post("/api/publish/web-webhook").set("x-publish-signature", "invalid").set("content-type", "application/json").send({ projectId: "p1", runId: "run1" })
    expect(res.status).toBe(401)
  })

  it("returns 404 when the deploy run does not exist", async () => {
    mockRunLookup(null)
    expect((await post("/api/publish/web-webhook", { projectId: "p1", runId: "run_missing" })).status).toBe(404)
  })

  it("handles the building stage ping", async () => {
    mockRunLookup({ id: "run1", status: "dispatching" })
    const res = await post("/api/publish/web-webhook", { projectId: "p1", runId: "run1", stage: "building" })
    expect(res.status).toBe(200)
    expect(web.markWebBuilding).toHaveBeenCalledWith("p1", "run1")
  })

  it("handles the deploying stage ping", async () => {
    mockRunLookup({ id: "run1", status: "building" })
    const res = await post("/api/publish/web-webhook", { projectId: "p1", runId: "run1", stage: "deploying" })
    expect(res.status).toBe(200)
    expect(web.markWebDeploying).toHaveBeenCalledWith("p1", "run1")
  })

  it("marks a successful deployment ready with its URL", async () => {
    mockRunLookup({ id: "run1", status: "deploying" })
    const res = await post("/api/publish/web-webhook", {
      projectId: "p1",
      runId: "run1",
      status: "ready",
      url: "https://my-app.expo.app",
      workflowRunUrl: "https://github.com/runs/1",
      easProjectId: "eas-proj-1",
      expoOwner: "expo-user",
    })
    expect(res.status).toBe(200)
    expect(web.markWebReady).toHaveBeenCalledWith("p1", "run1", { url: "https://my-app.expo.app", workflowRunUrl: "https://github.com/runs/1" })
    expect(mockUpdateEasProject).toHaveBeenCalledWith("p1", { easProjectId: "eas-proj-1", expoOwner: "expo-user" })
  })

  it("marks a deployment failed when an error is reported", async () => {
    mockRunLookup({ id: "run1", status: "deploying" })
    const res = await post("/api/publish/web-webhook", { projectId: "p1", runId: "run1", status: "failed", error: "EAS deploy timed out", workflowRunUrl: "https://github.com/runs/2" })
    expect(res.status).toBe(200)
    expect(web.markWebFailed).toHaveBeenCalledWith("p1", "run1", "EAS deploy timed out", { workflowRunUrl: "https://github.com/runs/2" })
  })
})
