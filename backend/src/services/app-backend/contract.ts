// What a generated app's backend must provide, whichever provider runs it:
// records, settings, files and the app's own end-user accounts. app-ops.ts
// serves the app's { op, ...args } calls from these, so a provider adapter
// implements AppServices and nothing in the op protocol (or the apps) changes.
// Copied into self-host exports with app-ops.ts, so it imports nothing.

/** `message` is safe to show to the app's user; `status` is the HTTP answer. */
export class AppBackendError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

/** A provisioned backend's credentials (stored encrypted); each provider defines its own keys. */
export type AppEnv = Record<string, string>

export type AppRecord = Record<string, unknown>

export type AppUser = { id: string; name: string; email: string; avatar?: string }

export interface AppDataApi {
  list(collection: string): Promise<AppRecord[]>
  get(collection: string, id: string): Promise<AppRecord | null>
  insert(collection: string, values: AppRecord): Promise<AppRecord>
  /** Throws a 404 AppBackendError when the record is gone. */
  update(collection: string, id: string, patch: AppRecord): Promise<AppRecord>
  remove(collection: string, id: string): Promise<void>
  settings(): Promise<Record<string, unknown>>
  setSetting(key: string, value: unknown): Promise<void>
  /** Bumped on every write; apps poll it to sync live. */
  version(): Promise<number>
}

export interface AppAuthApi {
  signUp(input: { name?: string; email: string; password: string }): Promise<{ token: string; user: AppUser }>
  signIn(input: { email: string; password: string }): Promise<{ token: string; user: AppUser }>
  /** null when signed out or the session expired. */
  current(token: string): Promise<AppUser | null>
  signOut(token: string): Promise<void>
  resetPassword(email: string): Promise<void>
}

export interface AppServices {
  data: AppDataApi
  auth: AppAuthApi
  /** Stores a picked file (a data: URL) and answers the URL it's served from. */
  upload(dataUrl: string): Promise<{ url: string }>
}
