import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createPublishWebhookSignature,
  verifyPublishWebhookSignature,
} from "../webhook-auth"

describe("webhook-auth", () => {
  const originalEnv = process.env.PUBLISH_WEBHOOK_SECRET
  const testSecret = "test_publish_secret_1234567890abcdef"

  beforeEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = testSecret
  })

  afterEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = originalEnv
  })

  it("verifies a valid signature successfully", () => {
    const body = JSON.stringify({ buildId: "b1", status: "ready" })
    const sig = createPublishWebhookSignature(body, testSecret)
    expect(verifyPublishWebhookSignature(body, sig)).toBe(true)
  })

  it("fails verification if the body was altered", () => {
    const body = JSON.stringify({ buildId: "b1", status: "ready" })
    const sig = createPublishWebhookSignature(body, testSecret)
    const alteredBody = JSON.stringify({ buildId: "b1", status: "failed" })
    expect(verifyPublishWebhookSignature(alteredBody, sig)).toBe(false)
  })

  it("fails verification if secret does not match", () => {
    const body = JSON.stringify({ buildId: "b1", status: "ready" })
    const sig = createPublishWebhookSignature(body, "different_secret")
    expect(verifyPublishWebhookSignature(body, sig)).toBe(false)
  })

  it("fails verification if header is expired beyond tolerance", () => {
    const body = JSON.stringify({ buildId: "b1", status: "ready" })
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400
    const sig = createPublishWebhookSignature(body, testSecret, oldTimestamp)
    expect(verifyPublishWebhookSignature(body, sig, 300)).toBe(false)
  })

  it("fails verification if header is missing or malformed", () => {
    const body = JSON.stringify({ buildId: "b1" })
    expect(verifyPublishWebhookSignature(body, null)).toBe(false)
    expect(verifyPublishWebhookSignature(body, "")).toBe(false)
    expect(verifyPublishWebhookSignature(body, "malformed")).toBe(false)
  })
})
