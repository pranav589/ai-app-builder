import { NextResponse } from "next/server"

import { getBackend, readEnv } from "@/lib/cloudhike/app-backend"
import { AppBackendError, readFile } from "@/lib/cloudhike/app-data"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * A file the app stored in its CloudHike bucket. The bucket is private, so
 * the bytes are served from here (one origin for the preview's CSP). The
 * path holds a random UUID, so file URLs work like unguessable links, the
 * way images saved in records need to.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string; key: string[] }> }) {
  const { projectId, key } = await params
  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) return new NextResponse("Not found", { status: 404 })
  try {
    const file = await readFile(readEnv(row), key.join("/"))
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "content-type": file.type,
        "cache-control": "private, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
        // Never let an uploaded file run as a page on our origin.
        "content-security-policy": "default-src 'none'; sandbox",
        ...(file.type === "application/pdf" ? {} : { "content-disposition": "inline" }),
      },
    })
  } catch (e) {
    if (e instanceof AppBackendError) return new NextResponse("Not found", { status: e.status === 404 ? 404 : 409 })
    console.error("serving app file failed", projectId, e)
    return new NextResponse("Unavailable", { status: 503 })
  }
}
