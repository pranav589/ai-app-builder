// The device backend for an app whose creator connected a backend provider.
// Same API as backendDevice() (templates.ts), so no screen changes, but data,
// auth and files go over HTTP, through Axios, to a server that holds the
// provider's credentials: the builder's public route
// (/api/app-runtime/[id]/data), or the self-host server shipped in a
// ZIP/GitHub export. The app itself never holds a secret; the only
// credential in the bundle is the public app key. Reads are cached and kept
// fresh with React Query instead of a bespoke poll loop; this module creates
// its own QueryClient and passes it explicitly to every hook
// (useQuery(options, queryClient)) so it works as a drop-in replacement for
// backendDevice() without the root layout needing a QueryClientProvider.

import type { FileMap } from "@app/shared/verify/types"

export const BACKEND_MODULE_PATH = "lib/backend/index.ts"
export const BACKEND_CONFIG_PATH = "lib/backend/config.ts"

/**
 * Where the app sends its calls. EXPO_PUBLIC_* overrides let an exported
 * project point at its own server without editing code.
 */
export function backendConfig(endpoint: string, appKey: string): string {
  return `// Where this app's data, auth and file calls go. Override with EXPO_PUBLIC_API_URL and
// EXPO_PUBLIC_APP_KEY in .env (see README) to use your own server.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || ${JSON.stringify(endpoint)}
export const APP_KEY: string = process.env.EXPO_PUBLIC_APP_KEY || ${JSON.stringify(appKey)}
`
}

export const remoteBackendFiles = (namespace: string, endpoint: string, appKey: string): FileMap => ({
  [BACKEND_MODULE_PATH]: backendRemote(namespace),
  [BACKEND_CONFIG_PATH]: backendConfig(endpoint, appKey),
})

/** Axios and React Query, used only by backendRemote() -- added to the exported package.json only once a backend is actually connected, so a disconnected app's dependencies stay untouched. */
const REMOTE_DEPENDENCIES: Record<string, string> = { axios: "^1.21.1", "@tanstack/react-query": "^5.108.0" }

/** Merges REMOTE_DEPENDENCIES into a package.json's dependencies; returns the source unchanged if it isn't valid JSON. */
export function withRemoteBackendDeps(packageJsonSource: string): string {
  try {
    const pkg = JSON.parse(packageJsonSource) as { dependencies?: Record<string, string>; [key: string]: unknown }
    return JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, ...REMOTE_DEPENDENCIES } }, null, 2) + "\n"
  } catch {
    return packageJsonSource
  }
}

/** `namespace` (the project id) keeps the stored sign-in session per app, for the same reason backendDevice's storage key is (Expo Go hosts every scanned project in one install). */
export function backendRemote(namespace: string): string {
  return String.raw`// Platform module: the app's data, auth and file storage, served by the
// app's backend over HTTP (see ./config) through Axios, cached and kept
// fresh with React Query. Same API as the local-storage version, so no
// screen has to change.
import { AppState } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import axios from "axios"
import { QueryClient, focusManager, useMutation, useQuery } from "@tanstack/react-query"
import seed from "@/data/seed.json"
import type { Collections } from "@/data/types"
import { API_URL, APP_KEY } from "./config"

type Rec = Record<string, unknown> & { id: string; createdAt: string; updatedAt?: string }
type Where = Partial<Record<string, unknown>> | ((r: Rec) => boolean)
type QueryOpts = { where?: Where; sort?: string; limit?: number }
type User = { id: string; name: string; email: string; avatar?: string }

const SESSION_KEY = ${JSON.stringify(`app:${namespace}:session`)}
const POLL_MS = 10000

// React Query only knows the window has focus on the web; on a device, tell
// it directly, so it stops polling once the app is backgrounded.
AppState.addEventListener("change", (status) => focusManager.setFocused(status === "active"))

// A standalone client (not from a QueryClientProvider in context) so this
// module is a drop-in replacement for backendDevice() -- the root layout
// doesn't need to know a backend is connected.
export const queryClient = new QueryClient()

let token = ""
let tokenLoaded: Promise<void> | null = null

function loadToken(): Promise<void> {
  tokenLoaded ??= AsyncStorage.getItem(SESSION_KEY).then(
    (v) => { token = v ?? "" },
    () => {}
  )
  return tokenLoaded
}

async function saveToken(next: string) {
  token = next
  try {
    if (next) await AsyncStorage.setItem(SESSION_KEY, next)
    else await AsyncStorage.removeItem(SESSION_KEY)
  } catch {}
}

const client = axios.create({ baseURL: API_URL, headers: { "x-app-key": APP_KEY } })

async function call<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  await loadToken()
  try {
    const res = await client.post("", { op, ...body }, { headers: { "x-app-session": token } })
    return (res.data as { result?: T }).result as T
  } catch (e) {
    if (axios.isAxiosError(e) && e.response) {
      const message = (e.response.data as { error?: string } | undefined)?.error || "Something went wrong. Please try again."
      console.warn("[backend] " + API_URL + ' (op "' + op + '") answered ' + e.response.status + ": " + message)
      throw new Error(message)
    }
    // Logged right here, not left for whichever caller happens to catch it, so this always shows
    // up once with the exact URL this app is trying to reach -- e.g. a device build that baked in
    // "localhost" (unreachable from a phone) shows up immediately instead of as a silent, permanent
    // loading state with no clue why.
    console.warn("[backend] Couldn't reach " + API_URL + ' (op "' + op + '"):', e instanceof Error ? e.message : e)
    throw new Error("You're offline. Check your connection and try again.")
  }
}

function query(rows: Rec[], opts: QueryOpts = {}) {
  let out = rows.slice()
  const w = opts.where
  if (typeof w === "function") out = out.filter(w)
  else if (w) out = out.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v))
  if (opts.sort) {
    const desc = opts.sort.startsWith("-")
    const key = desc ? opts.sort.slice(1) : opts.sort
    out.sort((a, b) => {
      const x = a[key] as never, y = b[key] as never
      if (x === y) return 0
      if (x == null) return 1
      if (y == null) return -1
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return desc ? -r : r
    })
  }
  return opts.limit ? out.slice(0, opts.limit) : out
}

export const db = {
  list(collection: string, opts?: QueryOpts) { return call<Rec[]>("list", { collection }).then((rows) => query(rows, opts)) },
  get(collection: string, id: string) { return call<Rec | null>("get", { collection, id }) },
  insert(collection: string, values: Record<string, unknown>) { return call<Rec>("insert", { collection, values }) },
  update(collection: string, id: string, patch: Record<string, unknown>) { return call<Rec>("update", { collection, id, patch }) },
  remove(collection: string, id: string) { return call<null>("remove", { collection, id }) },
}

export const kv = {
  async get<T = unknown>(key: string, fallback?: T) { return ((await call<Record<string, unknown>>("settings"))[key] ?? fallback) as T },
  set(key: string, value: unknown) { return call("setSetting", { key, value }) },
}

// The non-hook auth.signIn/signUp/signOut below are also what useUser's
// mutations call, but calling them directly (as this module's own code does
// right after a sign-up form, say) must keep useUser's cache in sync too, so
// invalidation lives here rather than only in the hook's onSuccess.
async function startSession(op: "auth.signUp" | "auth.signIn", input: Record<string, unknown>) {
  const r = await call<{ token: string; user: User }>(op, input)
  await saveToken(r.token)
  await queryClient.invalidateQueries({ queryKey: ["backend", "session"] })
  return r.user
}

export const auth = {
  current() { return call<User | null>("auth.current") },
  signUp(input: { name?: string; email: string; password: string }) { return startSession("auth.signUp", input) },
  signIn(input: { email: string; password: string }) { return startSession("auth.signIn", input) },
  async signOut() {
    await call("auth.signOut").catch(() => {})
    await saveToken("")
    await queryClient.invalidateQueries({ queryKey: ["backend", "session"] })
  },
  async resetPassword(input: { email: string }) { await call("auth.resetPassword", input) },
}

// A picked image's uri (file:// or content://) is read into a data URL for upload.
async function toDataUrl(uri: string): Promise<string> {
  if (uri.startsWith("data:")) return uri
  const blob = await (await fetch(uri)).blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("That file couldn't be read."))
    reader.readAsDataURL(blob)
  })
}

export const storage = {
  async upload(input: { uri: string; name?: string }) {
    return call<{ url: string }>("upload", { dataUrl: await toDataUrl(input.uri), name: input.name })
  },
}

export function useCollection<K extends keyof Collections>(
  collection: K,
  opts?: QueryOpts
): { data: Collections[K][]; loading: boolean; insert: (values: Partial<Collections[K]>) => Promise<Collections[K]>; update: (id: string, patch: Partial<Collections[K]>) => Promise<Collections[K]>; remove: (id: string) => Promise<void> }
export function useCollection(
  collection: string,
  opts?: QueryOpts
): { data: Rec[]; loading: boolean; insert: (values: Record<string, unknown>) => Promise<Rec>; update: (id: string, patch: Record<string, unknown>) => Promise<Rec>; remove: (id: string) => Promise<void> }
export function useCollection(collection: string, opts: QueryOpts = {}) {
  const q = useQuery({ queryKey: ["backend", collection, "list"], queryFn: () => call<Rec[]>("list", { collection }), refetchInterval: POLL_MS, retry: false }, queryClient)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backend", collection] })
  const insert = useMutation({ mutationFn: (values: Record<string, unknown>) => db.insert(collection, values), onSuccess: invalidate }, queryClient)
  const update = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => db.update(collection, id, patch), onSuccess: invalidate }, queryClient)
  const remove = useMutation({ mutationFn: (id: string) => db.remove(collection, id), onSuccess: invalidate }, queryClient)
  return {
    data: query(q.data ?? [], opts),
    loading: q.isPending,
    insert: (values: Record<string, unknown>) => insert.mutateAsync(values),
    update: (id: string, patch: Record<string, unknown>) => update.mutateAsync({ id, patch }),
    remove: (id: string) => remove.mutateAsync(id),
  }
}

export function useRecord<K extends keyof Collections>(
  collection: K,
  id: string | undefined | null
): { data: Collections[K] | null; loading: boolean; update: (patch: Partial<Collections[K]>) => Promise<Collections[K]>; remove: () => Promise<void> }
export function useRecord(
  collection: string,
  id: string | undefined | null
): { data: Rec | null; loading: boolean; update: (patch: Record<string, unknown>) => Promise<Rec>; remove: () => Promise<void> }
export function useRecord(collection: string, id: string | undefined | null) {
  const q = useQuery({ queryKey: ["backend", collection, "record", id ?? "first"], queryFn: () => call<Rec | null>("get", { collection, id: id ?? "" }), refetchInterval: POLL_MS, retry: false }, queryClient)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backend", collection] })
  const update = useMutation({ mutationFn: (patch: Record<string, unknown>) => db.update(collection, q.data!.id, patch), onSuccess: invalidate }, queryClient)
  const remove = useMutation({ mutationFn: () => db.remove(collection, q.data!.id), onSuccess: invalidate }, queryClient)
  return {
    data: q.data ?? null,
    loading: q.isPending,
    update: (patch: Record<string, unknown>) => (q.data ? update.mutateAsync(patch) : Promise.reject(new Error("Not found"))),
    remove: () => (q.data ? remove.mutateAsync() : Promise.resolve()),
  }
}

export function useSetting<T>(key: string, fallback: T): [T, (value: T) => Promise<void>] {
  const q = useQuery({ queryKey: ["backend", "settings"], queryFn: () => call<Record<string, unknown>>("settings"), retry: false }, queryClient)
  const set = useMutation({ mutationFn: (value: T) => kv.set(key, value), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backend", "settings"] }) }, queryClient)
  const value = (q.data && key in q.data ? q.data[key] : fallback) as T
  return [value, (v: T) => set.mutateAsync(v)]
}

export function useUser() {
  const q = useQuery({ queryKey: ["backend", "session"], queryFn: () => auth.current(), refetchInterval: POLL_MS, retry: false }, queryClient)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backend", "session"] })
  const signIn = useMutation({ mutationFn: auth.signIn, onSuccess: invalidate }, queryClient)
  const signUp = useMutation({ mutationFn: auth.signUp, onSuccess: invalidate }, queryClient)
  const signOut = useMutation({ mutationFn: auth.signOut, onSuccess: invalidate }, queryClient)
  return {
    user: q.data ?? (seed.user as User),
    signedIn: !!q.data,
    signIn: (input: { email: string; password: string }) => signIn.mutateAsync(input),
    signUp: (input: { name?: string; email: string; password: string }) => signUp.mutateAsync(input),
    signOut: () => signOut.mutateAsync(),
  }
}
`
}
