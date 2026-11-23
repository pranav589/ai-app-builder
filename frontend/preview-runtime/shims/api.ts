// "@/lib/api" in the preview, once a backend is connected. Same call shape
// (api.get/post/patch/put/delete, each resolving to { data }) as the real
// generated client (backend/src/services/app-project/api-client.ts), but
// every call becomes an "http" RPC to the host instead of a real HTTP
// request -- answered from the configured backend (local storage, or the
// connected provider) the same way every other data call in the preview is.
// See app-runtime.tsx handleRpc's "http" case for the host side.

import { QueryClient } from "@tanstack/react-query"
import { rpc } from "../bridge"

export const queryClient = new QueryClient()

export class ApiError extends Error {
  code?: string
  response?: { status: number; data: { error?: string } }
}

async function call(method: string, url: string, data?: unknown): Promise<{ data: unknown }> {
  try {
    const result = await rpc("http", { method, url, data })
    return { data: result }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Something went wrong. Please try again."
    const err = new ApiError(message)
    err.response = { status: 400, data: { error: message } }
    throw err
  }
}

export const api = {
  get: (url: string) => call("GET", url),
  post: (url: string, data?: unknown) => call("POST", url, data),
  patch: (url: string, data?: unknown) => call("PATCH", url, data),
  put: (url: string, data?: unknown) => call("PUT", url, data),
  delete: (url: string) => call("DELETE", url),
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function getApiErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isApiError(error)) return error.response?.data?.error || error.message || fallback
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default { api, queryClient, isApiError, getApiErrorMessage }
