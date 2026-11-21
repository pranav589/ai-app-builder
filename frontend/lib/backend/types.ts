// The one interface every generated app talks to for data, files and auth.
// Screens never see it directly: they send declarative requests to the host
// page, and the host calls whichever backend is configured: the browser's
// local storage until the creator connects a backend provider, then that
// provider's database, storage and auth (through our server). Nothing in the
// screens or the runtime changes when that switch happens.

import type { BackendProviderId } from "@app/shared/app-backend/providers"
import type { DataModel } from "@app/shared/app-runtime/data-model"

export type AppRecord = Record<string, unknown> & { id: string; createdAt: string; updatedAt?: string }

export type AppUser = { id: string; name: string; email: string; avatar?: string }

export type BackendChange =
  | { type: "db"; collection: string }
  | { type: "kv" }
  | { type: "auth" }
  | { type: "reset" }

export interface AppDatabase {
  list(collection: string): Promise<AppRecord[]>
  get(collection: string, id: string): Promise<AppRecord | null>
  insert(collection: string, values: Record<string, unknown>): Promise<AppRecord>
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<AppRecord>
  remove(collection: string, id: string): Promise<void>
}

/** Small app-wide values: settings toggles, preferences, onboarding flags. */
export interface AppKeyValue {
  all(): Promise<Record<string, unknown>>
  set(key: string, value: unknown): Promise<void>
}

export interface AppStorage {
  /** Stores an image or file and returns a URL screens can display. */
  upload(file: { dataUrl: string; name?: string }): Promise<{ url: string }>
}

export interface AppAuth {
  current(): Promise<AppUser | null>
  signIn(input: { email: string; password: string }): Promise<AppUser>
  signUp(input: { name?: string; email: string; password: string }): Promise<AppUser>
  signOut(): Promise<void>
  resetPassword(input: { email: string }): Promise<void>
}

export interface AppBackend {
  readonly provider: "local" | BackendProviderId
  /** Prepares storage for this app's data model (seeding on first run). */
  init(model: DataModel): Promise<void>
  /** Everything the preview shows, in one request, for backends where each call is a round trip. */
  snapshot?(collections: string[]): Promise<{ collections: Record<string, AppRecord[]>; settings: Record<string, unknown>; user: AppUser | null }>
  db: AppDatabase
  kv: AppKeyValue
  storage: AppStorage
  auth: AppAuth
  /** Fires after every write, including writes from other tabs. */
  subscribe(listener: (change: BackendChange) => void): () => void
  /** Wipes the app's data back to its seed. */
  reset(): Promise<void>
}

/** A failure whose message is fine to show to the person using the app. */
export class BackendError extends Error {}
