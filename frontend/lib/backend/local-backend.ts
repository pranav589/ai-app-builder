"use client"

// Local-storage backend: the default until a CloudHike account is connected.
// One JSON document per project, seeded from the app's data model. It keeps
// the same semantics a remote backend will have (ids, timestamps, async
// calls, change events), so moving to CloudHike is a provider swap.

import { newRecordId, type DataModel } from "@app/shared/app-runtime/data-model"
import { BackendError, type AppBackend, type AppRecord, type AppUser, type BackendChange } from "./types"

type StoredUser = AppUser & { passwordHash: string }

type LocalState = {
  seedHash: string
  collections: Record<string, AppRecord[]>
  settings: Record<string, unknown>
  users: StoredUser[]
  sessionUserId: string | null
}

const now = () => new Date().toISOString()

async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(`anything-local:${password}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Downscales a picked photo so local storage doesn't fill up after a few images. */
export async function compressImage(dataUrl: string, max = 960): Promise<string> {
  if (!dataUrl.startsWith("data:image/") || dataUrl.startsWith("data:image/svg")) return dataUrl
  const img = new Image()
  img.src = dataUrl
  await img.decode().catch(() => undefined)
  if (!img.naturalWidth) return dataUrl
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.82)
}

function seedState(model: DataModel): LocalState {
  const stamp = Date.now()
  const collections: Record<string, AppRecord[]> = {}
  for (const c of model.collections) {
    collections[c.name] = c.seed.map((r, i) => ({
      ...r,
      id: String(r.id),
      // Seeds keep their own dates; otherwise space them out so sorting by date is meaningful.
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(stamp - i * 3_600_000).toISOString(),
    }))
  }
  return {
    seedHash: model.hash,
    collections,
    settings: { ...model.settings },
    users: [],
    sessionUserId: null,
  }
}

export class LocalBackend implements AppBackend {
  readonly provider = "local" as const
  private key: string
  private state: LocalState | null = null
  private model: DataModel | null = null
  private listeners = new Set<(c: BackendChange) => void>()
  private onStorage = (e: StorageEvent) => {
    if (e.key !== this.key) return
    this.state = null
    this.emit({ type: "reset" })
  }

  constructor(projectId: string) {
    this.key = `anything:app-data:${projectId}`
    if (typeof window !== "undefined") window.addEventListener("storage", this.onStorage)
  }

  async init(model: DataModel) {
    this.model = model
    const s = this.read()
    // An empty hash means the model isn't known yet: never wipe data for it.
    if (model.hash && s.seedHash !== model.hash) {
      // The data model changed (the plan was revised): start from the new seed.
      this.state = seedState(model)
      this.write()
    }
    for (const c of model.collections) this.read().collections[c.name] ??= []
  }

  private read(): LocalState {
    if (this.state) return this.state
    let parsed: LocalState | null = null
    try {
      const raw = window.localStorage.getItem(this.key)
      parsed = raw ? (JSON.parse(raw) as LocalState) : null
    } catch {
      parsed = null
    }
    this.state = parsed && parsed.collections ? parsed : seedState(this.model ?? { collections: [], settings: {}, user: { name: "", email: "" }, hash: "" })
    return this.state
  }

  private write() {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(this.state))
    } catch {
      throw new BackendError("This device's storage is full. Remove some photos and try again.")
    }
  }

  private emit(change: BackendChange) {
    for (const l of this.listeners) l(change)
  }

  private rows(collection: string) {
    const s = this.read()
    return (s.collections[collection] ??= [])
  }

  db = {
    list: async (collection: string) => [...this.rows(collection)],
    get: async (collection: string, id: string) => this.rows(collection).find((r) => r.id === id) ?? null,
    insert: async (collection: string, values: Record<string, unknown>) => {
      const rec: AppRecord = { ...values, id: newRecordId(), createdAt: now() }
      // Newest first, like a feed.
      this.rows(collection).unshift(rec)
      this.write()
      this.emit({ type: "db", collection })
      return rec
    },
    update: async (collection: string, id: string, patch: Record<string, unknown>) => {
      const rows = this.rows(collection)
      const i = rows.findIndex((r) => r.id === id)
      if (i === -1) throw new BackendError("That item no longer exists.")
      const { id: _id, createdAt: _c, ...rest } = patch
      rows[i] = { ...rows[i], ...rest, updatedAt: now() }
      this.write()
      this.emit({ type: "db", collection })
      return rows[i]
    },
    remove: async (collection: string, id: string) => {
      const s = this.read()
      s.collections[collection] = this.rows(collection).filter((r) => r.id !== id)
      this.write()
      this.emit({ type: "db", collection })
    },
  }

  kv = {
    all: async () => ({ ...this.read().settings }),
    set: async (key: string, value: unknown) => {
      this.read().settings[key] = value
      this.write()
      this.emit({ type: "kv" })
    },
  }

  storage = {
    upload: async ({ dataUrl }: { dataUrl: string; name?: string }) => ({ url: await compressImage(dataUrl) }),
  }

  auth = {
    current: async (): Promise<AppUser | null> => {
      const s = this.read()
      const u = s.users.find((x) => x.id === s.sessionUserId)
      return u ? { id: u.id, name: u.name, email: u.email, avatar: u.avatar } : null
    },
    signUp: async ({ name, email, password }: { name?: string; email: string; password: string }) => {
      const s = this.read()
      const e = String(email ?? "").trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new BackendError("Enter a valid email address.")
      if (String(password ?? "").length < 6) throw new BackendError("Use at least 6 characters for the password.")
      if (s.users.some((u) => u.email === e)) throw new BackendError("An account with this email already exists.")
      const user: StoredUser = {
        id: newRecordId(),
        name: String(name ?? "").trim() || e.split("@")[0],
        email: e,
        passwordHash: await hashPassword(password),
      }
      s.users.push(user)
      s.sessionUserId = user.id
      this.write()
      this.emit({ type: "auth" })
      return { id: user.id, name: user.name, email: user.email }
    },
    signIn: async ({ email, password }: { email: string; password: string }) => {
      const s = this.read()
      const e = String(email ?? "").trim().toLowerCase()
      if (!e || !password) throw new BackendError("Enter your email and password.")
      let user = s.users.find((u) => u.email === e)
      // In the preview there are no real accounts yet, so a first sign-in creates one.
      if (!user) return this.auth.signUp({ email: e, password, name: this.model?.user.name })
      if (user.passwordHash !== (await hashPassword(password))) throw new BackendError("That password isn't right.")
      s.sessionUserId = user.id
      this.write()
      this.emit({ type: "auth" })
      user = s.users.find((u) => u.id === s.sessionUserId)!
      return { id: user.id, name: user.name, email: user.email }
    },
    signOut: async () => {
      this.read().sessionUserId = null
      this.write()
      this.emit({ type: "auth" })
    },
    resetPassword: async ({ email }: { email: string }) => {
      if (!/^\S+@\S+\.\S+$/.test(String(email ?? ""))) throw new BackendError("Enter a valid email address.")
    },
  }

  subscribe(listener: (c: BackendChange) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async reset() {
    this.state = seedState(this.model ?? { collections: [], settings: {}, user: { name: "", email: "" }, hash: "" })
    this.write()
    this.emit({ type: "reset" })
  }

  dispose() {
    window.removeEventListener("storage", this.onStorage)
    this.listeners.clear()
  }
}
