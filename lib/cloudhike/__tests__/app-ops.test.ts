import { describe, expect, it, vi } from "vitest"
import type { DataModel } from "@/lib/app-runtime/data-model-types"
import { AppBackendError } from "../app-data"
import { appOpFailure, runAppOp, type OpContext } from "../app-ops"

const data = {
  list: vi.fn(async (c: string) => [{ id: "1", collection: c }]),
  get: vi.fn(),
  insert: vi.fn(async (_c: string, v: unknown) => v),
  update: vi.fn(),
  remove: vi.fn(),
  settings: vi.fn(async () => ({})),
  setSetting: vi.fn(),
  version: vi.fn(async () => 7),
}
const auth = { current: vi.fn(async () => null), signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), resetPassword: vi.fn() }

// The real database and CloudHike Auth are exercised elsewhere; this is about which calls get through.
vi.mock("../app-data", async (orig) => ({
  ...(await orig<typeof import("../app-data")>()),
  dataApi: () => data,
  authApi: () => auth,
}))

const model: DataModel = { collections: [{ name: "tasks", label: "Tasks", fields: [], seed: [] }], settings: {}, user: { name: "A", email: "a@b.c" }, hash: "h" }
const ctx = (over: Partial<OpContext> = {}): OpContext => ({
  projectId: "p1",
  env: {},
  model,
  session: "tok",
  fileUrl: (k) => `https://x/${k}`,
  resetRedirect: "https://x/",
  declaredOnly: true,
  ...over,
})

describe("runAppOp with declaredOnly", () => {
  it("serves a declared collection", async () => {
    expect(await runAppOp(ctx(), { op: "list", collection: "tasks" })).toEqual([{ id: "1", collection: "tasks" }])
  })

  it.each(["list", "get", "insert", "update", "remove"])("refuses %s on a collection the data model doesn't declare", async (op) => {
    await expect(runAppOp(ctx(), { op, collection: "secrets", id: "1" })).rejects.toMatchObject({ status: 404 })
  })

  it("lets the builder's own preview use any collection", async () => {
    expect(await runAppOp(ctx({ declaredOnly: false }), { op: "list", collection: "adhoc" })).toHaveLength(1)
  })

  it("answers a snapshot with an empty list for an undeclared collection instead of failing", async () => {
    const r = (await runAppOp(ctx(), { op: "snapshot", collections: ["tasks", "secrets"] })) as { collections: Record<string, unknown[]>; version: number }
    expect(r.collections.tasks).toHaveLength(1)
    expect(r.collections.secrets).toEqual([])
    expect(r.version).toBe(7)
  })

  it("passes the end user's session to auth", async () => {
    await runAppOp(ctx(), { op: "auth.current" })
    expect(auth.current).toHaveBeenCalledWith("tok")
  })

  it("rejects schema setup and anything unknown", async () => {
    await expect(runAppOp(ctx(), { op: "init" })).rejects.toMatchObject({ status: 400 })
    await expect(runAppOp(ctx(), null)).rejects.toMatchObject({ status: 400 })
  })
})

describe("appOpFailure", () => {
  it("passes a backend error's message and status through", () => {
    expect(appOpFailure(new AppBackendError("Nope", 409), "x")).toEqual({ error: "Nope", status: 409 })
  })

  it("hides unexpected errors, and says a sleeping database is waking up", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(appOpFailure(new Error("password for user postgres failed"), "x")).toEqual({ error: "Something went wrong. Please try again.", status: 500 })
    expect(appOpFailure(new Error("connect ETIMEDOUT 1.2.3.4:5432"), "x").status).toBe(503)
  })
})
