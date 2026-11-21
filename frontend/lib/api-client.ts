import axios, { type AxiosError } from "axios"

export interface ApiErrorResponse<T = Record<string, unknown>> {
  error?: string
  fieldErrors?: Record<string, string | undefined>
  [key: string]: unknown
}

/**
 * Shared Axios client instance for all client-side API calls across the project.
 * Uses default headers and handles JSON requests/responses.
 */
export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
})

/**
 * Checks if an error is an API / HTTP error from the client.
 */
export function isApiError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error)
}

/**
 * Checks if an error was caused by a request being cancelled / aborted.
 */
export function isApiCancelled(error: unknown): boolean {
  return axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError")
}

/**
 * Checks if an error is due to a network connection failure or offline state.
 */
export function isApiNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.code === "ERR_NETWORK" || !error.response)
}

/**
 * Gets the HTTP status code from an API error if available.
 */
export function getApiErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}

/**
 * Gets the structured payload returned by the server on an error.
 */
export function getApiErrorData<T = ApiErrorResponse>(error: unknown): T | undefined {
  if (axios.isAxiosError(error) && error.response?.data) {
    return error.response.data as T
  }
  return undefined
}

/**
 * Extracts a user-friendly error message from an API call error.
 */
export function getApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined
    if (data?.error && typeof data.error === "string") return data.error
    if (error.code === "ERR_NETWORK" || !error.response) {
      return "Network error. Check your connection and try again."
    }
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}
