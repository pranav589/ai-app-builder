import "server-only"
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// Encrypts secrets at rest (CloudHike access tokens, a backend's .env) with
// AES-256-GCM, and signs small values (OAuth state) with HMAC-SHA256.
// The key comes from CLOUDHIKE_ENCRYPTION_KEY: 32 random bytes, base64 or hex
// (`openssl rand -base64 32`). Rotating it makes stored secrets unreadable, so
// users would have to connect again.

export class SecretKeyError extends Error {}

let cached: Buffer | null = null

function key(): Buffer {
  if (cached) return cached
  const raw = process.env.CLOUDHIKE_ENCRYPTION_KEY?.trim()
  if (!raw) throw new SecretKeyError("CLOUDHIKE_ENCRYPTION_KEY is not set.")
  let bytes: Buffer | null = null
  if (/^[0-9a-f]{64}$/i.test(raw)) bytes = Buffer.from(raw, "hex")
  else {
    const b = Buffer.from(raw, "base64")
    if (b.length === 32) bytes = b
  }
  if (!bytes) {
    if (raw.length < 32) throw new SecretKeyError("CLOUDHIKE_ENCRYPTION_KEY must be 32 random bytes (base64 or hex).")
    // A long passphrase: derive a key from it.
    bytes = createHash("sha256").update(raw).digest()
  }
  cached = bytes
  return bytes
}

const b64 = (b: Buffer) => b.toString("base64url")

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `v1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`
}

export function decryptSecret(box: string): string {
  const [v, iv, tag, ct] = box.split(".")
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new SecretKeyError("Unreadable secret.")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8")
}

/** `<payload>.<signature>`; the payload is readable, only the signature is secret. */
export function sign(payload: string): string {
  const mac = createHmac("sha256", key()).update(payload).digest()
  return `${payload}.${b64(mac)}`
}

export function verifySigned(value: string): string | null {
  const i = value.lastIndexOf(".")
  if (i <= 0) return null
  const payload = value.slice(0, i)
  const got = Buffer.from(value.slice(i + 1), "base64url")
  const want = createHmac("sha256", key()).update(payload).digest()
  return got.length === want.length && timingSafeEqual(got, want) ? payload : null
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
