// "@/lib/backend" in the preview. Same API as the generated
// lib/backend/index.ts that ships with the app, but every call goes to the
// host, which runs the configured backend (local storage now, CloudHike
// later). Hooks re-render when any frame changes the data.

import * as React from "react"
import { dataStore, rpc } from "../bridge"

type Rec = Record<string, unknown> & { id: string; createdAt?: string }
type Where = Partial<Record<string, unknown>> | ((r: Rec) => boolean)
type QueryOpts = { where?: Where; sort?: string; limit?: number }

const useData = () => React.useSyncExternalStore(dataStore.subscribe, dataStore.get)

function query(rows: Rec[], opts: QueryOpts = {}) {
  let out = rows.slice()
  const w = opts.where
  if (typeof w === "function") out = out.filter(w)
  else if (w) out = out.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v))
  if (opts.sort) {
    const desc = opts.sort.startsWith("-")
    const key = desc ? opts.sort.slice(1) : opts.sort
    out.sort((a, b) => {
      const x = a[key] as never
      const y = b[key] as never
      if (x === y) return 0
      if (x == null) return 1
      if (y == null) return -1
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return desc ? -r : r
    })
  }
  if (opts.limit) out = out.slice(0, opts.limit)
  return out
}

export const db = {
  list: async (collection: string, opts?: QueryOpts) => query((dataStore.get().collections[collection] ?? []) as Rec[], opts),
  get: async (collection: string, id: string) => ((dataStore.get().collections[collection] ?? []) as Rec[]).find((r) => r.id === id) ?? null,
  insert: (collection: string, values: Record<string, unknown>) => rpc<Rec>("db.insert", { collection, values }),
  update: (collection: string, id: string, patch: Record<string, unknown>) => rpc<Rec>("db.update", { collection, id, patch }),
  remove: (collection: string, id: string) => rpc<void>("db.remove", { collection, id }),
}

export const kv = {
  get: async <T = unknown>(key: string, fallback?: T) => (dataStore.get().settings[key] ?? fallback) as T,
  set: (key: string, value: unknown) => rpc<void>("kv.set", { key, value }),
}

export const auth = {
  current: async () => (dataStore.get().signedIn ? dataStore.get().user : null),
  signIn: (input: { email: string; password: string }) => rpc("auth.signin", input),
  signUp: (input: { name?: string; email: string; password: string }) => rpc("auth.signup", input),
  signOut: () => rpc<void>("auth.signOut"),
  resetPassword: (input: { email: string }) => rpc<void>("auth.reset", input),
}

export const storage = {
  /** Stores a picked image (uri from expo-image-picker) and returns a displayable URL. */
  upload: (input: { uri: string; name?: string }) => rpc<{ url: string }>("storage.upload", { dataUrl: input.uri, name: input.name }),
}

export function useCollection(collection: string, opts: QueryOpts = {}) {
  const snapshot = useData()
  const rows = (snapshot.collections[collection] ?? []) as Rec[]
  const data = query(rows, opts)
  return {
    data,
    loading: false,
    insert: (values: Record<string, unknown>) => db.insert(collection, values),
    update: (id: string, patch: Record<string, unknown>) => db.update(collection, id, patch),
    remove: (id: string) => db.remove(collection, id),
  }
}

export function useRecord(collection: string, id: string | undefined | null) {
  const snapshot = useData()
  const rows = (snapshot.collections[collection] ?? []) as Rec[]
  const data = (id ? rows.find((r) => r.id === String(id)) : rows[0]) ?? null
  return {
    data,
    loading: false,
    update: (patch: Record<string, unknown>) => (data ? db.update(collection, data.id, patch) : Promise.reject(new Error("Not found"))),
    remove: () => (data ? db.remove(collection, data.id) : Promise.resolve()),
  }
}

export function useSetting<T>(key: string, fallback: T): [T, (value: T) => Promise<void>] {
  const snapshot = useData()
  const value = (key in snapshot.settings ? snapshot.settings[key] : fallback) as T
  return [value, (v: T) => kv.set(key, v)]
}

export function useUser() {
  const snapshot = useData()
  return {
    user: snapshot.user,
    signedIn: snapshot.signedIn,
    signIn: auth.signIn,
    signUp: auth.signUp,
    signOut: auth.signOut,
  }
}

export default { db, kv, auth, storage, useCollection, useRecord, useSetting, useUser }
