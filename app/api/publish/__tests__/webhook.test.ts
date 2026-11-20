import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPublishWebhookSignature } from "@/lib/publish/webhook-auth"

const { mockGetBuild, mockMarkReady, mockMarkFailed, mockUpdateEasProject } = vi.hoisted(() => {
  const mockGetBuild = vi.fn()
  const mockMarkReady = vi.fn().mockResolvedValue(undefined)
  const mockMarkFailed = vi.fn().mockResolvedValue(undefined)
  const mockUpdateEasProject = vi.fn().mockResolvedValue(undefined)
  return { mockGetBuild, mockMarkReady, mockMarkFailed, mockUpdateEasProject }
})

vi.mock("@/lib/publish/builds", () => ({
  getBuild: mockGetBuild,
  markReady: mockMarkReady,
  markFailed: mockMarkFailed,
}))

vi.mock("@/lib/publish/app-identity", () => ({
  updateEasProject: mockUpdateEasProject,
}))

const { POST } = await import("../webhook/route")

describe("POST /api/publish/webhook", () => {
  const secret = "test_webhook_secret_key_12345678"
  const originalEnv = process.env.PUBLISH_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = secret
    mockGetBuild.mockReset()
    mockMarkReady.mockClear()
    mockMarkFailed.mockClear()
    mockUpdateEasProject.mockClear()
  })

  afterEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = originalEnv
  })

  it("returns 401 when signature header is missing or invalid", async () => {
    const req = new Request("http://localhost:3000/api/publish/webhook", {
      method: "POST",
      body: JSON.stringify({ buildId: "b1" }),
      headers: { "x-publish-signature": "invalid" },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 404 when build does not exist", async () => {
    mockGetBuild.mockResolvedValue(null)

    const body = JSON.stringify({ buildId: "b_missing" })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it("processes a successful build and marks it ready", async () => {
    mockGetBuild.mockResolvedValue({
      id: "b1",
      projectId: "p1",
      status: "building",
    })

    const body = JSON.stringify({
      buildId: "b1",
      status: "ready",
      easBuildId: "eas-123",
      artifactUrl: "https://expo.dev/artifacts/test.apk",
      workflowRunUrl: "https://github.com/runs/1",
      easProjectId: "eas-proj-1",
      expoOwner: "expo-user",
    })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkReady).toHaveBeenCalledWith("b1", {
      artifactUrl: "https://expo.dev/artifacts/test.apk",
      easBuildId: "eas-123",
      workflowRunUrl: "https://github.com/runs/1",
    })
    expect(mockUpdateEasProject).toHaveBeenCalledWith("p1", {
      easProjectId: "eas-proj-1",
      expoOwner: "expo-user",
    })
  })

  it("marks build failed with needsIosCredentials=1 when missing credentials reported", async () => {
    mockGetBuild.mockResolvedValue({
      id: "b2",
      projectId: "p1",
      status: "building",
    })

    const body = JSON.stringify({
      buildId: "b2",
      status: "failed",
      error: "Apple Developer credentials missing",
      needsIosCredentials: 1,
    })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkFailed).toHaveBeenCalledWith("b2", expect.objectContaining({
      error: "Apple Developer credentials missing",
      needsIosCredentials: 1,
    }))
  })

  it("returns 200 immediately without re-processing if build is already terminal", async () => {
    mockGetBuild.mockResolvedValue({
      id: "b3",
      projectId: "p1",
      status: "ready",
    })

    const body = JSON.stringify({
      buildId: "b3",
      status: "ready",
      artifactUrl: "https://expo.dev/artifacts/test.apk",
    })
    const sig = createPublishWebhookSignature(body, secret)

    const req = new Request("http://localhost:3000/api/publish/webhook", {
      method: "POST",
      body,
      headers: { "x-publish-signature": sig },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkReady).not.toHaveBeenCalled()
  })
})
