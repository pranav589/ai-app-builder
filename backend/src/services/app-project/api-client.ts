// The Axios client + React Query setup a connected app's screens call
// directly (useQuery/useMutation with api.get/post/patch/delete), mirroring
// this builder's own frontend/lib/api-client.ts: one shared Axios instance,
// plus small helpers for reading an error. Unlike the legacy backendRemote()
// (backend-remote.ts, kept only for apps generated before this redesign),
// this isn't a drop-in swap for a platform data module: lib/api.ts and
// lib/api-config.ts are written straight into the *stored* project by the
// backend-conversion step (agent/backend-conversion.ts) when a backend is
// connected, and removed again on disconnect, because the screens
// themselves are rewritten to call it -- there's no uniform hook API left
// to swap underneath them.

import type { FileMap } from "@app/shared/verify/types"

export const API_PATH = "lib/api.ts"
export const API_CONFIG_PATH = "lib/api-config.ts"

/** Axios/React Query, added to the stored package.json once a backend is connected (shared/app-project/prune.ts drops them again once nothing imports them, after a disconnect). */
export const API_CLIENT_DEPENDENCIES: Record<string, string> = { axios: "^1.21.1", "@tanstack/react-query": "^5.108.0" }

/** Where the app's REST calls go. EXPO_PUBLIC_* overrides let an exported project point at its own server without editing code. */
export function apiConfig(endpoint: string, appKey: string): string {
  return `// Where this app's data, auth and file calls go. Override with EXPO_PUBLIC_API_URL and
// EXPO_PUBLIC_APP_KEY in .env (see README) to use your own server.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || ${JSON.stringify(endpoint)}
export const APP_KEY: string = process.env.EXPO_PUBLIC_APP_KEY || ${JSON.stringify(appKey)}
`
}

/** `appSlug` namespaces the stored session token per app, for the same reason the local store's AsyncStorage keys are (Expo Go hosts every scanned project in one install). */
export function apiClientSource(appSlug: string): string {
  return String.raw`// Platform module: the Axios client this app's connected backend calls --
// see docs/api-reference.md for the routes, or just read the screens that
// use it. Mutations invalidate the React Query cache they affect; read
// their "onSuccess" for the pattern. Import, never rewrite.
import axios, { type AxiosError } from "axios"
import { QueryClient } from "@tanstack/react-query"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { API_URL, APP_KEY } from "./api-config"

export const queryClient = new QueryClient()

export const api = axios.create({ baseURL: API_URL, headers: { "x-app-key": APP_KEY } })

const SESSION_KEY = ${JSON.stringify(`app:${appSlug}:session`)}
let session = ""
let loaded: Promise<void> | null = null
function loadSession(): Promise<void> {
  loaded ??= AsyncStorage.getItem(SESSION_KEY).then((v) => { session = v ?? "" }, () => {})
  return loaded
}
async function setSession(next: string) {
  session = next
  try {
    if (next) await AsyncStorage.setItem(SESSION_KEY, next)
    else await AsyncStorage.removeItem(SESSION_KEY)
  } catch {}
}

api.interceptors.request.use(async (config) => {
  await loadSession()
  config.headers.set("x-app-session", session)
  return config
})

// Signing in or out keeps the stored session in sync automatically, so a
// screen's sign-in/sign-up mutation never has to remember to persist it.
api.interceptors.response.use(async (res) => {
  if ((res.config.url === "/auth/sign-in" || res.config.url === "/auth/sign-up") && (res.data as { token?: string } | undefined)?.token) {
    await setSession((res.data as { token: string }).token)
  }
  if (res.config.url === "/auth/sign-out") await setSession("")
  return res
})

/** Checks if an error is an API/HTTP error from the client. */
export function isApiError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error)
}

/** Extracts a user-friendly error message from an API call error. */
export function getApiErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined
    if (data?.error && typeof data.error === "string") return data.error
    if (error.code === "ERR_NETWORK" || !error.response) return "You're offline. Check your connection and try again."
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}
`
}

export const apiClientFiles = (appSlug: string, endpoint: string, appKey: string): FileMap => ({
  [API_PATH]: apiClientSource(appSlug),
  [API_CONFIG_PATH]: apiConfig(endpoint, appKey),
})

/** Merges API_CLIENT_DEPENDENCIES into a package.json's dependencies; returns the source unchanged if it isn't valid JSON. */
export function withApiClientDeps(packageJsonSource: string): string {
  try {
    const pkg = JSON.parse(packageJsonSource) as { dependencies?: Record<string, string>; [key: string]: unknown }
    return JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, ...API_CLIENT_DEPENDENCIES } }, null, 2) + "\n"
  } catch {
    return packageJsonSource
  }
}
