import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

import { getBackend, readEnv } from "@/lib/cloudhike/app-backend"
import { appOpFailure, runAppOp } from "@/lib/cloudhike/app-ops"
import { overLimit } from "@/lib/cloudhike/rate-limit"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { readJson } from "@/lib/http"
import { db, projects } from "@/db"
import { eq } from "drizzle-orm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Built apps (APK, Expo Go preview, web deploy, ZIP/GitHub export) call this
// from outside our origin, so it answers CORS for any origin. That's safe here
// because nothing is authorized by cookies: the caller proves itself with the
// project's app key, and signed-in end users add their own session token.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-app-key, x-app-session",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
}

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { ...CORS, "cache-control": "no-store" } })

const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * The data, auth and storage calls of an app built from the builder. The same
 * operations as the builder's own preview route (/api/projects/[id]/backend/data)
 * minus schema setup, limited to the collections the app's data model declares.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  if (overLimit(`${projectId}:${ip}`, 240, 60_000)) return reply({ error: "Too many requests. Try again in a moment." }, 429)

  const row = await getBackend(projectId)
  const key = req.headers.get("x-app-key") ?? ""
  if (!row || row.status !== "ready" || !row.envEnc || !row.appKey || !sameKey(key, row.appKey)) return reply({ error: "This app isn't connected to a backend." }, 403)

  const body = await readJson(req)
  try {
    const [project] = await db.select({ previewScreens: projects.previewScreens }).from(projects).where(eq(projects.id, projectId)).limit(1)
    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
    const result = await runAppOp(
      {
        projectId,
        env: readEnv(row),
        model: readAppDoc(project?.previewScreens).data,
        session: req.headers.get("x-app-session") ?? "",
        fileUrl: (k) => `${base}/api/app-files/${encodeURIComponent(projectId)}/${k}`,
        resetRedirect: `${base}/`,
        declaredOnly: true,
      },
      body
    )
    return reply({ result })
  } catch (e) {
    const failure = appOpFailure(e, `${projectId} ${String(body?.op)}`)
    return reply({ error: failure.error }, failure.status)
  }
}
