// The device backend for an app whose creator connected CloudHike. Same API
// as backendDevice() (templates.ts), so no screen changes, but data, auth and
// files go over HTTP to a server that holds the CloudHike credentials: the
// builder's public route (/api/app-runtime/[id]/data), or the self-host
// server shipped in a ZIP/GitHub export. The app itself never holds a secret;
// the only credential in the bundle is the public app key.

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

/** `namespace` (the project id) keeps the stored sign-in session per app, for the same reason backendDevice's storage key is (Expo Go hosts every scanned project in one install). */
export function backendRemote(namespace: string): string {
  return String.raw`// Platform module: the app's data, auth and file storage, served by the app's
// backend over HTTP (see ./config). Same API as the local-storage version, so
// no screen has to change.
import * as React from "react"
import { AppState } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import seed from "@/data/seed.json"
import type { Collections } from "@/data/types"
import { API_URL, APP_KEY } from "./config"

type Rec = Record<string, unknown> & { id: string; createdAt: string; updatedAt?: string }
type Where = Partial<Record<string, unknown>> | ((r: Rec) => boolean)
type QueryOpts = { where?: Where; sort?: string; limit?: number }
type User = { id: string; name: string; email: string; avatar?: string }
type Snapshot = { collections: Record<string, Rec[]>; settings: Record<string, unknown>; user: User | null }

const SESSION_KEY = ${JSON.stringify(`app:${namespace}:session`)}
const POLL_MS = 10000

let snap: Snapshot = { collections: {}, settings: {}, user: null }
const listeners = new Set<() => void>()
const wanted = new Set<string>()
let token = ""
let tokenLoaded: Promise<void> | null = null
let version = -1
let pollTimer: ReturnType<typeof setInterval> | null = null

function notify() {
  for (const l of listeners) l()
}

// Replaces "snap" wholesale (never mutates it in place) so useSyncExternalStore
// and the React Compiler see a new snapshot, same reason as the local version.
function setSnap(next: Snapshot) {
  snap = next
  notify()
}

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

async function call<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  await loadToken()
  let res: Response
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": APP_KEY, "x-app-session": token },
      body: JSON.stringify({ op, ...body }),
    })
  } catch (e) {
    // Logged right here, not left for whichever caller happens to catch it, so this always shows
    // up once with the exact URL this app is trying to reach -- e.g. a device build that baked in
    // "localhost" (unreachable from a phone) shows up immediately instead of as a silent, permanent
    // loading state with no clue why.
    console.warn("[backend] Couldn't reach " + API_URL + ' (op "' + op + '"):', e instanceof Error ? e.message : e)
    throw new Error("You're offline. Check your connection and try again.")
  }
  const data = (await res.json().catch(() => null)) as { result?: T; error?: string } | null
  if (!res.ok) {
    console.warn("[backend] " + API_URL + ' (op "' + op + '") answered ' + res.status + ": " + (data?.error ?? "no error message"))
    throw new Error(data?.error || "Something went wrong. Please try again.")
  }
  return data?.result as T
}

// One snapshot request serves every hook that asked at the same moment; a
// refresh requested while one is running runs once more afterwards.
let refreshing: Promise<void> | null = null
let again = false

function refresh(): Promise<void> {
  if (refreshing) {
    again = true
    return refreshing
  }
  refreshing = (async () => {
    try {
      do {
        again = false
        const r = await call<Snapshot & { version: number }>("snapshot", { collections: [...wanted] })
        version = r.version
        setSnap({ collections: r.collections, settings: r.settings, user: r.user })
      } while (again)
    } catch {
      // call() already logged the detail (the URL, the status or the raw error); a sleeping
      // database or a dropped connection just means the next poll or want() tries again.
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function poll() {
  if (AppState.currentState !== "active") return
  try {
    const v = await call<number>("version")
    if (v !== version) await refresh()
  } catch {}
}

// Settings and the signed-in user come with every snapshot; a screen that only
// uses those still needs the first one.
function ensureLoaded() {
  if (version === -1) void refresh()
}

function want(collection: string) {
  if (wanted.has(collection)) return
  wanted.add(collection)
  void refresh()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  pollTimer ??= setInterval(poll, POLL_MS)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

const getSnapshot = () => snap

function useStore(): Snapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot)
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

// A write shows up in every hook at once, then the next snapshot confirms it.
function putRecord(collection: string, rec: Rec) {
  const rows = snap.collections[collection] ?? []
  const i = rows.findIndex((r) => r.id === rec.id)
  const next = i === -1 ? [rec, ...rows] : rows.map((r, j) => (j === i ? rec : r))
  setSnap({ ...snap, collections: { ...snap.collections, [collection]: next } })
}

export const db = {
  async list(collection: string, opts?: QueryOpts) { return query(await call<Rec[]>("list", { collection }), opts) },
  get(collection: string, id: string) { return call<Rec | null>("get", { collection, id }) },
  async insert(collection: string, values: Record<string, unknown>) {
    const rec = await call<Rec>("insert", { collection, values })
    putRecord(collection, rec)
    void refresh()
    return rec
  },
  async update(collection: string, id: string, patch: Record<string, unknown>) {
    const rec = await call<Rec>("update", { collection, id, patch })
    putRecord(collection, rec)
    void refresh()
    return rec
  },
  async remove(collection: string, id: string) {
    await call("remove", { collection, id })
    setSnap({ ...snap, collections: { ...snap.collections, [collection]: (snap.collections[collection] ?? []).filter((r) => r.id !== id) } })
    void refresh()
  },
}

export const kv = {
  async get<T = unknown>(key: string, fallback?: T) { return ((await call<Record<string, unknown>>("settings"))[key] ?? fallback) as T },
  async set(key: string, value: unknown) {
    await call("setSetting", { key, value })
    setSnap({ ...snap, settings: { ...snap.settings, [key]: value } })
    void refresh()
  },
}

async function startSession(op: "auth.signUp" | "auth.signIn", input: Record<string, unknown>) {
  const r = await call<{ token: string; user: User }>(op, input)
  await saveToken(r.token)
  setSnap({ ...snap, user: r.user })
  void refresh()
  return r.user
}

export const auth = {
  current() { return call<User | null>("auth.current") },
  signUp(input: { name?: string; email: string; password: string }) { return startSession("auth.signUp", input) },
  signIn(input: { email: string; password: string }) { return startSession("auth.signIn", input) },
  async signOut() {
    await call("auth.signOut").catch(() => {})
    await saveToken("")
    setSnap({ ...snap, user: null })
    void refresh()
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
  const snapshot = useStore()
  React.useEffect(() => want(collection), [collection])
  return {
    data: query(snapshot.collections[collection] ?? [], opts),
    loading: !(collection in snapshot.collections),
    insert: (values: Record<string, unknown>) => db.insert(collection, values),
    update: (id: string, patch: Record<string, unknown>) => db.update(collection, id, patch),
    remove: (id: string) => db.remove(collection, id),
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
  const snapshot = useStore()
  React.useEffect(() => want(collection), [collection])
  const rows = snapshot.collections[collection] ?? []
  const data = (id ? rows.find((r) => r.id === String(id)) : rows[0]) ?? null
  return {
    data,
    loading: !(collection in snapshot.collections),
    update: (patch: Record<string, unknown>) => (data ? db.update(collection, data.id, patch) : Promise.reject(new Error("Not found"))),
    remove: () => (data ? db.remove(collection, data.id) : Promise.resolve()),
  }
}

export function useSetting<T>(key: string, fallback: T): [T, (value: T) => Promise<void>] {
  const snapshot = useStore()
  React.useEffect(ensureLoaded, [])
  const value = (key in snapshot.settings ? snapshot.settings[key] : fallback) as T
  return [value, (v: T) => kv.set(key, v)]
}

export function useUser() {
  const snapshot = useStore()
  React.useEffect(ensureLoaded, [])
  return {
    user: snapshot.user ?? (seed.user as User),
    signedIn: !!snapshot.user,
    signIn: auth.signIn,
    signUp: auth.signUp,
    signOut: auth.signOut,
  }
}
`
}
