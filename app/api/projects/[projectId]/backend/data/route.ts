import { getBackend, readEnv } from "@/lib/cloudhike/app-backend"
import { AppBackendError, syncSchema } from "@/lib/cloudhike/app-data"
import { appOpFailure, runAppOp } from "@/lib/cloudhike/app-ops"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The preview's data, auth and storage calls for an app on CloudHike. The
 * creator's session authorizes the call; this server holds the app's
 * CloudHike credentials. The app's own end users sign in against the app's
 * CloudHike Auth; their session token travels in x-app-session. Built apps
 * use the public sibling route instead (/api/app-runtime/[id]/data).
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400)
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const row = await getBackend(projectId)
  if (!row || row.status !== "ready" || !row.envEnc) return json({ error: "This app isn't connected to CloudHike." }, 409)

  const body = await readJson(req)
  const op = str(body?.op)
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")

  try {
    const env = readEnv(row)
    const model = readAppDoc(owned.project.previewScreens).data
    if (op === "init") {
      if (model && model.hash !== row.schemaHash) await syncSchema(env, model)
      return json({ result: null })
    }
    const result = await runAppOp(
      {
        projectId,
        env,
        model,
        session: req.headers.get("x-app-session") ?? "",
        fileUrl: (key) => `${base}/api/app-files/${encodeURIComponent(projectId)}/${key}`,
        resetRedirect: `${base}/`,
        declaredOnly: false,
      },
      body
    )
    return json({ result })
  } catch (e) {
    const failure = appOpFailure(e, `${projectId} ${op}`)
    return json({ error: failure.error }, failure.status)
  }
}
