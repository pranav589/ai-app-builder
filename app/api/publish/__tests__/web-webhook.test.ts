import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPublishWebhookSignature } from "@/lib/publish/webhook-auth"

const {
  mockDbSelect,
  mockMarkWebReady,
  mockMarkWebFailed,
  mockMarkWebDeploying,
  mockMarkWebBuilding,
  mockUpdateEasProject,
} = vi.hoisted(() => {
  const mockDbSelect = vi.fn()
  const mockMarkWebReady = vi.fn().mockResolvedValue(undefined)
  const mockMarkWebFailed = vi.fn().mockResolvedValue(undefined)
  const mockMarkWebDeploying = vi.fn().mockResolvedValue(undefined)
  const mockMarkWebBuilding = vi.fn().mockResolvedValue(undefined)
  const mockUpdateEasProject = vi.fn().mockResolvedValue(undefined)
  return {
    mockDbSelect,
    mockMarkWebReady,
    mockMarkWebFailed,
    mockMarkWebDeploying,
    mockMarkWebBuilding,
    mockUpdateEasProject,
  }
})

function mockRunLookup(run: { id: string; status: string } | null) {
  const mockLimit = vi.fn().mockResolvedValue(run ? [run] : [])
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  mockDbSelect.mockReturnValue({ from: mockFrom })
}

vi.mock("@/db", () => ({
  db: { select: mockDbSelect },
  webDeployRuns: { id: "id", projectId: "projectId" },
}))

vi.mock("@/lib/publish/web-deploy", () => ({
  markWebReady: mockMarkWebReady,
  markWebFailed: mockMarkWebFailed,
  markWebDeploying: mockMarkWebDeploying,
  markWebBuilding: mockMarkWebBuilding,
}))

vi.mock("@/lib/publish/app-identity", () => ({
  updateEasProject: mockUpdateEasProject,
}))

const { POST } = await import("../web-webhook/route")

describe("POST /api/publish/web-webhook", () => {
  const secret = "test_webhook_secret_key_12345678"
  const originalEnv = process.env.PUBLISH_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = secret
    mockDbSelect.mockReset()
    mockMarkWebReady.mockClear()
    mockMarkWebFailed.mockClear()
    mockMarkWebDeploying.mockClear()
    mockMarkWebBuilding.mockClear()
    mockUpdateEasProject.mockClear()
  })

  afterEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = originalEnv
  })

  it("returns 401 when signature header is missing or invalid", async () => {
    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1", runId: "run1" }),
      headers: { "x-publish-signature": "invalid" },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 404 when the deploy run does not exist", async () => {
    mockRunLookup(null)

    const body = JSON.stringify({ projectId: "p1", runId: "run_missing" })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it("handles mid-workflow ping for building stage", async () => {
    mockRunLookup({ id: "run1", status: "dispatching" })

    const body = JSON.stringify({ projectId: "p1", runId: "run1", stage: "building" })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkWebBuilding).toHaveBeenCalledWith("p1", "run1")
  })

  it("handles mid-workflow ping for deploying stage", async () => {
    mockRunLookup({ id: "run1", status: "building" })

    const body = JSON.stringify({ projectId: "p1", runId: "run1", stage: "deploying" })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkWebDeploying).toHaveBeenCalledWith("p1", "run1")
  })

  it("processes a successful web deployment and marks it ready with URL", async () => {
    mockRunLookup({ id: "run1", status: "deploying" })

    const body = JSON.stringify({
      projectId: "p1",
      runId: "run1",
      status: "ready",
      url: "https://my-app.expo.app",
      workflowRunUrl: "https://github.com/runs/1",
      easProjectId: "eas-proj-1",
      expoOwner: "expo-user",
    })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkWebReady).toHaveBeenCalledWith("p1", "run1", {
      url: "https://my-app.expo.app",
      workflowRunUrl: "https://github.com/runs/1",
    })
    expect(mockUpdateEasProject).toHaveBeenCalledWith("p1", {
      easProjectId: "eas-proj-1",
      expoOwner: "expo-user",
    })
  })

  it("marks deployment as failed when error is reported or url missing", async () => {
    mockRunLookup({ id: "run1", status: "deploying" })

    const body = JSON.stringify({
      projectId: "p1",
      runId: "run1",
      status: "failed",
      error: "EAS deploy timed out",
      workflowRunUrl: "https://github.com/runs/2",
    })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkWebFailed).toHaveBeenCalledWith("p1", "run1", "EAS deploy timed out", {
      workflowRunUrl: "https://github.com/runs/2",
    })
  })

  it("is idempotent when the run is already in a terminal state", async () => {
    mockRunLookup({ id: "run1", status: "ready" })

    const body = JSON.stringify({
      projectId: "p1",
      runId: "run1",
      status: "ready",
      url: "https://my-app.expo.app",
    })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/web-webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.alreadyFinished).toBe(true)
    expect(mockMarkWebReady).not.toHaveBeenCalled()
  })
})
