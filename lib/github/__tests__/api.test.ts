import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getRef, GithubApiError } from "../api"

describe("getRef", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("returns null when GitHub returns 404 Not Found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({ message: "Not Found" }),
    })

    const ref = await getRef("tok", "owner", "repo", "heads/main")
    expect(ref).toBeNull()
  })

  it("returns null when GitHub returns 409 'Git Repository is empty.'", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: async () => ({ message: "Git Repository is empty." }),
    })

    const ref = await getRef("tok", "owner", "repo", "heads/main")
    expect(ref).toBeNull()
  })

  it("returns the ref object when the reference exists", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        ref: "refs/heads/main",
        object: { sha: "abc12345", type: "commit" },
      }),
    })

    const ref = await getRef("tok", "owner", "repo", "heads/main")
    expect(ref).toEqual({
      ref: "refs/heads/main",
      object: { sha: "abc12345", type: "commit" },
    })
  })

  it("throws other errors such as 401 auth_expired", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ message: "Bad credentials" }),
    })

    await expect(getRef("tok", "owner", "repo", "heads/main")).rejects.toThrow(
      GithubApiError
    )
  })
})
