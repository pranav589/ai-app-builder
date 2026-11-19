"use client"

// CloudHike backend: the app's data, settings, files and users live in the
// creator's CloudHike project (Database, Storage, Auth). CloudHike has no
// browser data API, so every call goes to this app's server
// (/api/projects/[id]/backend/data), which holds the project's credentials;
// nothing secret ever reaches the browser.
//
// Live sync: every write bumps a version counter in the app's database. This
// client polls it while the page is visible and refreshes when another
// device or tab changed something.

import type { DataModel } from "@/lib/app-runtime/data-model"
import { apiClient, getApiErrorData, isApiNetworkError } from "@/lib/api-client"
import { compressImage } from "./local-backend"
import { BackendError, type AppBackend, type AppRecord, type AppUser, type BackendChange } from "./types"

export type CloudHikeConfig = { projectRef: string; region?: string }

const POLL_MS = 3000

export class CloudHikeBackend implements AppBackend {
  readonly provider = "cloudhike" as const
  private listeners = new Set<(c: BackendChange) => void>()
  private version = -1
  private timer: ReturnType<typeof setInterval> | null = null
  private sessionKey: string

  constructor(
    readonly appId: string,
    readonly config: CloudHikeConfig
  ) {
    this.sessionKey = `anything:cloudhike-session:${appId}`
  }

  private get session() {
    try {
      return window.localStorage.getItem(this.sessionKey) ?? ""
    } catch {
      return ""
    }
  }

  private set session(token: string) {
    try {
      if (token) window.localStorage.setItem(this.sessionKey, token)
      else window.localStorage.removeItem(this.sessionKey)
    } catch {}
  }

  private async call<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
    try {
      const res = await apiClient.post<{ result?: T; error?: string }>(
        `/api/projects/${encodeURIComponent(this.appId)}/backend/data`,
        { op, ...body },
        {
          headers: { "x-app-session": this.session },
        }
      )
      return res.data.result as T
    } catch (err) {
      const data = getApiErrorData<{ error?: string }>(err)
      if (data?.error) throw new BackendError(data.error)
      if (isApiNetworkError(err)) {
        throw new BackendError("You're offline. Check your connection and try again.")
      }
      throw new BackendError("Something went wrong. Please try again.")
    }
  }

  private emit(change: BackendChange) {
    for (const l of this.listeners) l(change)
  }

  /** After our own write: tell listeners now, and remember the counter isn't news. */
  private wrote(change: BackendChange) {
    this.version = -2
    this.emit(change)
  }

  async init(_model: DataModel) {
    await this.call("init")
  }

  /** Everything the preview shows, in one request. */
  async snapshot(collections: string[]) {
    const r = await this.call<{
      collections: Record<string, AppRecord[]>
      settings: Record<string, unknown>
      user: AppUser | null
      version: number
    }>("snapshot", { collections })
    this.version = r.version
    return r
  }

  db = {
    list: (collection: string) => this.call<AppRecord[]>("list", { collection }),
    get: (collection: string, id: string) => this.call<AppRecord | null>("get", { collection, id }),
    insert: async (collection: string, values: Record<string, unknown>) => {
      const r = await this.call<AppRecord>("insert", { collection, values })
      this.wrote({ type: "db", collection })
      return r
    },
    update: async (collection: string, id: string, patch: Record<string, unknown>) => {
      const r = await this.call<AppRecord>("update", { collection, id, patch })
      this.wrote({ type: "db", collection })
      return r
    },
    remove: async (collection: string, id: string) => {
      await this.call("remove", { collection, id })
      this.wrote({ type: "db", collection })
    },
  }

  kv = {
    all: () => this.call<Record<string, unknown>>("settings"),
    set: async (key: string, value: unknown) => {
      await this.call("setSetting", { key, value })
      this.wrote({ type: "kv" })
    },
  }

  storage = {
    upload: async ({ dataUrl, name }: { dataUrl: string; name?: string }) =>
      this.call<{ url: string }>("upload", { dataUrl: await compressImage(dataUrl, 1600), name }),
  }

  auth = {
    current: () => this.call<AppUser | null>("auth.current"),
    signUp: async (input: { name?: string; email: string; password: string }) => {
      const r = await this.call<{ token: string; user: AppUser }>("auth.signUp", input)
      this.session = r.token
      this.emit({ type: "auth" })
      return r.user
    },
    signIn: async (input: { email: string; password: string }) => {
      const r = await this.call<{ token: string; user: AppUser }>("auth.signIn", input)
      this.session = r.token
      this.emit({ type: "auth" })
      return r.user
    },
    signOut: async () => {
      await this.call("auth.signOut").catch(() => {})
      this.session = ""
      this.emit({ type: "auth" })
    },
    resetPassword: async ({ email }: { email: string }) => {
      await this.call("auth.resetPassword", { email })
    },
  }

  private poll = async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return
    try {
      const v = await this.call<number>("version")
      if (this.version >= 0 && v !== this.version) this.emit({ type: "reset" })
      this.version = v
    } catch {
      // A sleeping database or a blip: try again on the next tick.
    }
  }

  subscribe(listener: (c: BackendChange) => void) {
    this.listeners.add(listener)
    this.timer ??= setInterval(this.poll, POLL_MS)
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  async reset() {
    // Real data in the creator's CloudHike database is never wiped from the preview.
    throw new BackendError("This app's data lives in CloudHike. Manage or clear it in your CloudHike dashboard.")
  }

  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
  }
}
