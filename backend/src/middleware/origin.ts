import type { Request, Response, NextFunction } from "express"

// Frontend and backend are now different origins by design (different ports in dev,
// different subdomains in prod), so a mutating request's Origin header never equals
// this server's own Host -- the old single-app same-origin check (Origin.host === Host)
// cannot be reused as-is. Instead this validates Origin against the same trust boundary
// as CORS (the frontend's allowed origins), which is the correct equivalent for a split
// frontend/backend: it still blocks a cross-site <form> POST (which never triggers a CORS
// preflight and ignores what CORS would let the browser *read*), while still allowing the
// real frontend's calls through.
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.replace(/\/+$/, "")] : []),
]

export function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true
  if (origin.endsWith(".local")) return true
  if (origin.startsWith("http://192.168.") || origin.startsWith("http://10.")) return true
  // Matches the permissiveness already baked into index.ts's cors() config: local dev
  // runs frontend/backend on different ports with no fixed set of LAN addresses.
  if (process.env.NODE_ENV !== "production") return true
  return false
}

/** Rejects cross-site requests. A request with no Origin (non-browser client, or a browser omitting it on some same-site requests) is allowed, same as the old isSameOrigin. */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    res.status(400).json({ error: "Bad request" })
    return
  }
  next()
}

/** requireTrustedOrigin, plus rejects non-JSON bodies (for routes that only ever expect application/json). */
export function requireTrustedOriginJson(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    res.status(400).json({ error: "Bad request" })
    return
  }
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    res.status(400).json({ error: "Bad request" })
    return
  }
  next()
}
