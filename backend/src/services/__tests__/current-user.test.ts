import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IdentityUser } from "../identity"

const getSessionUser = vi.fn<(token: string) => Promise<IdentityUser | null>>()
const ensureUser = vi.fn(async (u: IdentityUser) => ({ id: u.id, name: u.name ?? null, email: u.email, credits: 100 }))

// Any identity provider works here: the session check only goes through `identity`.
vi.mock("@/lib/identity", async (orig) => ({
  ...(await orig<typeof import("../identity")>()),
  identity: { getSessionUser: (t: string) => getSessionUser(t) },
}))
vi.mock("@/lib/users", () => ({ ensureUser: (u: IdentityUser) => ensureUser(u) }))

const { getCurrentUser, ServiceUnavailableError } = await import("../current-user")

beforeEach(() => {
  getSessionUser.mockReset()
  ensureUser.mockClear()
})

describe("getCurrentUser", () => {
  it("is null without a token, and never asks the provider", async () => {
    expect(await getCurrentUser(null)).toBeNull()
    expect(getSessionUser).not.toHaveBeenCalled()
  })

  it("answers the app user for the provider's session user", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", email: "a@b.c", name: "A" })
    expect(await getCurrentUser("tok")).toEqual({ id: "u1", name: "A", email: "a@b.c", credits: 100 })
    expect(getSessionUser).toHaveBeenCalledWith("tok")
  })

  it("is null once the provider says the session is gone", async () => {
    getSessionUser.mockResolvedValue(null)
    expect(await getCurrentUser("tok")).toBeNull()
  })

  it("throws ServiceUnavailableError when the provider keeps failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    getSessionUser.mockRejectedValue(new Error("down"))
    await expect(getCurrentUser("tok")).rejects.toBeInstanceOf(ServiceUnavailableError)
  })
})
