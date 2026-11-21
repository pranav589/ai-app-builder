import { AppBackendError, type AppServices } from "./contract"
import type { DataModel } from "@app/shared/app-runtime/data-model-types"

// The operations an app can run against its backend ({ op, ...args } in, a
// result out). One dispatcher shared by the builder's preview route, the
// public route exported apps call, and the self-host server shipped in a ZIP
// export (a provider's self-host files copy this file), so all three behave
// identically. It never knows which provider answers: the caller hands it that
// provider's AppServices. Imports stay limited to ./contract and the
// types-only data-model file for that reason.

export type OpContext = {
  services: AppServices
  model?: DataModel | null
  /** The app end-user's session token from the provider's auth ("" when signed out). */
  session: string
  /** Callers outside the builder may only touch collections the data model declares, so a leaked key can't create arbitrary tables. */
  declaredOnly: boolean
}

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === "string" ? v : "")

export async function runAppOp(ctx: OpContext, body: Record<string, unknown> | null): Promise<unknown> {
  const op = str(body?.op)
  const collection = str(body?.collection)
  const id = str(body?.id)
  const declared = (name: string) => !ctx.declaredOnly || !!ctx.model?.collections.some((c) => c.name === name)
  const requireDeclared = (name: string) => {
    if (!declared(name)) throw new AppBackendError("Unknown collection.", 404)
  }

  const { data, auth } = ctx.services

  switch (op) {
    case "snapshot": {
      const names = (Array.isArray(body?.collections) ? body.collections : []).map(String).slice(0, 50)
      const [lists, settings, user, version] = await Promise.all([
        Promise.all(names.map(async (n) => [n, declared(n) ? await data.list(n) : []] as const)),
        data.settings(),
        auth.current(ctx.session),
        data.version(),
      ])
      return { collections: Object.fromEntries(lists), settings, user, version }
    }
    case "version":
      return data.version()
    case "list":
      requireDeclared(collection)
      return data.list(collection)
    case "get":
      requireDeclared(collection)
      return data.get(collection, id)
    case "insert":
      requireDeclared(collection)
      return data.insert(collection, obj(body?.values))
    case "update":
      requireDeclared(collection)
      return data.update(collection, id, obj(body?.patch))
    case "remove":
      requireDeclared(collection)
      await data.remove(collection, id)
      return null
    case "settings":
      return data.settings()
    case "setSetting":
      await data.setSetting(str(body?.key), body?.value)
      return null
    case "upload":
      return ctx.services.upload(str(body?.dataUrl))
    case "auth.current":
      return auth.current(ctx.session)
    case "auth.signUp":
      return auth.signUp({ name: str(body?.name), email: str(body?.email).trim().toLowerCase(), password: str(body?.password) })
    case "auth.signIn":
      return auth.signIn({ email: str(body?.email).trim().toLowerCase(), password: str(body?.password) })
    case "auth.signOut":
      await auth.signOut(ctx.session)
      return null
    case "auth.resetPassword":
      await auth.resetPassword(str(body?.email).trim().toLowerCase())
      return null
    default:
      throw new AppBackendError("Unknown operation.", 400)
  }
}

/** A thrown error as the { error, status } a caller should answer with. Unexpected ones are logged here, not leaked. */
export function appOpFailure(e: unknown, what: string): { error: string; status: number } {
  if (e instanceof AppBackendError) return { error: e.message, status: e.status }
  console.error("app backend call failed", what, e)
  const msg = e instanceof Error ? e.message : ""
  // Free hosted databases (CloudHike's, among others) sleep when idle; the first call wakes them.
  if (/ECONNREFUSED|ETIMEDOUT|terminating connection|connect_timeout|sleep/i.test(msg))
    return { error: "The app's database is waking up. Try again in a moment.", status: 503 }
  return { error: "Something went wrong. Please try again.", status: 500 }
}
