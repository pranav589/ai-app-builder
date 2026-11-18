import { authApi, AppBackendError, dataApi, getBackend, readEnv, syncSchema, uploadFile } from "@/lib/cloudhike/app-backend"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { isSameOriginJson, json, readJson, str } from "@/lib/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * The preview's data, auth and storage calls for an app on CloudHike. The
 * creator's session authorizes the call; this server holds the app's
 * CloudHike credentials. The app's own end users sign in against the app's
 * CloudHike Auth; their session token travels in x-app-session.
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
  const collection = str(body?.collection)
  const id = str(body?.id)
  const session = req.headers.get("x-app-session") ?? ""

  try {
    const env = readEnv(row)
    // The project's current data model: writes for a collection it declares
    // land in that collection's real columns, not a generic blob.
    const model = readAppDoc(owned.project.previewScreens).data
    const data = dataApi(projectId, env, model)
    const auth = authApi(env)
    switch (op) {
      case "init": {
        if (model && model.hash !== row.schemaHash) await syncSchema(env, model)
        return json({ result: null })
      }
      case "snapshot": {
        const names = (Array.isArray(body?.collections) ? body.collections : []).map(String).slice(0, 50)
        const [lists, settings, user, version] = await Promise.all([
          Promise.all(names.map(async (n: string) => [n, await data.list(n)] as const)),
          data.settings(),
          auth.current(session),
          data.version(),
        ])
        return json({ result: { collections: Object.fromEntries(lists), settings, user, version } })
      }
      case "version":
        return json({ result: await data.version() })
      case "list":
        return json({ result: await data.list(collection) })
      case "get":
        return json({ result: await data.get(collection, id) })
      case "insert":
        return json({ result: await data.insert(collection, obj(body?.values)) })
      case "update":
        return json({ result: await data.update(collection, id, obj(body?.patch)) })
      case "remove":
        await data.remove(collection, id)
        return json({ result: null })
      case "settings":
        return json({ result: await data.settings() })
      case "setSetting":
        await data.setSetting(str(body?.key), body?.value)
        return json({ result: null })
      case "upload":
        return json({ result: await uploadFile(projectId, env, str(body?.dataUrl)) })
      case "auth.current":
        return json({ result: await auth.current(session) })
      case "auth.signUp":
        return json({ result: await auth.signUp({ name: str(body?.name), email: str(body?.email).trim().toLowerCase(), password: str(body?.password) }) })
      case "auth.signIn":
        return json({ result: await auth.signIn({ email: str(body?.email).trim().toLowerCase(), password: str(body?.password) }) })
      case "auth.signOut":
        await auth.signOut(session)
        return json({ result: null })
      case "auth.resetPassword":
        await auth.resetPassword(str(body?.email).trim().toLowerCase())
        return json({ result: null })
      default:
        return json({ error: "Unknown operation." }, 400)
    }
  } catch (e) {
    if (e instanceof AppBackendError) return json({ error: e.message }, e.status)
    console.error("app backend call failed", projectId, op, e)
    const msg = e instanceof Error ? e.message : ""
    // A free CloudHike database sleeps when idle; the first call wakes it.
    if (/ECONNREFUSED|ETIMEDOUT|terminating connection|connect_timeout|sleep/i.test(msg))
      return json({ error: "The app's database is waking up. Try again in a moment." }, 503)
    return json({ error: "Something went wrong. Please try again." }, 500)
  }
}
