import { describe, expect, it } from "vitest"
import axios, { AxiosError, AxiosHeaders } from "axios"
import {
  apiClient,
  getApiErrorData,
  getApiErrorMessage,
  getApiErrorStatus,
  isApiCancelled,
  isApiError,
  isApiNetworkError,
} from "../api-client"

describe("apiClient", () => {
  it("creates a shared axios instance with default json header", () => {
    expect(apiClient).toBeDefined()
    expect(typeof apiClient.get).toBe("function")
    expect(typeof apiClient.post).toBe("function")
    expect(typeof apiClient.delete).toBe("function")
    expect(typeof apiClient.patch).toBe("function")
    expect(apiClient.defaults.headers["Content-Type"]).toBe("application/json")
  })
})

describe("API Error Helpers", () => {
  it("correctly identifies axios errors and extracts status and data", () => {
    const error = new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
      data: { error: "Name exists" },
      status: 409,
      statusText: "Conflict",
      headers: {},
      config: { headers: new AxiosHeaders() },
    })

    expect(isApiError(error)).toBe(true)
    expect(isApiError(new Error("Generic"))).toBe(false)
    expect(getApiErrorStatus(error)).toBe(409)
    expect(getApiErrorData(error)).toEqual({ error: "Name exists" })
  })

  it("handles cancelled and abort requests", () => {
    const cancelError = new axios.CanceledError("canceled")
    const abortError = new DOMException("The user aborted a request.", "AbortError")
    expect(isApiCancelled(cancelError)).toBe(true)
    expect(isApiCancelled(abortError)).toBe(true)
    expect(isApiCancelled(new Error("Other"))).toBe(false)
  })

  it("detects network errors", () => {
    const networkError = new AxiosError("Network Error", "ERR_NETWORK")
    expect(isApiNetworkError(networkError)).toBe(true)
    expect(isApiNetworkError(new Error("Fail"))).toBe(false)
  })
})

describe("getApiErrorMessage", () => {
  it("extracts error message from an Axios error response", () => {
    const error = new AxiosError("Request failed with status code 400", "ERR_BAD_REQUEST", undefined, undefined, {
      data: { error: "Custom server error" },
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: { headers: new AxiosHeaders() },
    })

    expect(getApiErrorMessage(error)).toBe("Custom server error")
  })

  it("handles network errors properly", () => {
    const error = new AxiosError("Network Error", "ERR_NETWORK")
    expect(getApiErrorMessage(error)).toBe("Network error. Check your connection and try again.")
  })

  it("extracts message from standard Error", () => {
    const error = new Error("Standard runtime error")
    expect(getApiErrorMessage(error)).toBe("Standard runtime error")
  })

  it("falls back to default fallback when error is unknown", () => {
    expect(getApiErrorMessage(null, "Custom fallback")).toBe("Custom fallback")
    expect(getApiErrorMessage(undefined)).toBe("Something went wrong. Please try again.")
  })
})
