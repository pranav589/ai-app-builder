import { createHmac, timingSafeEqual } from "node:crypto"

function publishWebhookSecret(): string | undefined {
  return process.env.PUBLISH_WEBHOOK_SECRET
}

/**
 * Creates a Stripe-style `t=<timestamp>,v1=<hex>` signature header
 * computed as HMAC-SHA256 over `${t}.${rawBody}`.
 */
export function createPublishWebhookSignature(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  return `t=${timestamp},v1=${hmac}`
}

/**
 * Checks `x-publish-signature: t=<unix seconds>,v1=<hex>`, where v1 is
 * HMAC-SHA256 of `<t>.<raw body>` keyed with PUBLISH_WEBHOOK_SECRET.
 */
export function verifyPublishWebhookSignature(rawBody: string, header: string | null, toleranceSeconds = 300): boolean {
  const key = publishWebhookSecret()
  if (!key || !header) return false

  let t = ""
  const sigs: string[] = []
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2)
    if (k === "t") t = v ?? ""
    else if (k === "v1" && v) sigs.push(v)
  }

  const ts = Number(t)
  if (!t || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false

  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest()
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex")
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}
