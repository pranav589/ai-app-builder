// @vitest-environment jsdom
//
// Mounts the generated remote backend (the one an app gets once its creator
// connected a backend provider) under a real React root, the same way
// backend-device.test.ts does for the local one: hooks must show server
// data, reflect writes at once, and carry the app key and the signed-in
// user's session on every call. Axios and React Query are faked at the
// boundary this generated module actually calls (axios.create/.post), not
// at the network layer, since the point of this test is the generated
// code's own request/cache logic, not Axios's or React Query's internals.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { transform } from "sucrase"
import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { QueryClient, focusManager, useMutation, useQuery } from "@tanstack/react-query"

import { backendConfig, backendRemote, remoteBackendFiles, withRemoteBackendDeps } from "../backend-remote"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Rec = { id: string; title?: string }
type Backend = {
  useCollection: (c: string) => { data: Rec[]; loading: boolean; insert: (v: Record<string, unknown>) => Promise<Rec> }
  useUser: () => { user: { name: string }; signedIn: boolean }
  auth: { signIn: (i: { email: string; password: string }) => Promise<unknown> }
}
type Call = { op: string; headers: Record<string, string>; body: Record<string, unknown> }

const KEY = "app-key-123"
const ENDPOINT = "https://builder.example/api/app-runtime/p1/data"

/** A stand-in for the backend route: tasks live in memory, sign-in returns a token. */
function fakeServer() {
  const calls: Call[] = []
  const tasks: Rec[] = [{ id: "t1", title: "Existing" }]
  let user: { id: string; name: string; email: string } | null = null
  const handle = (body: Record<string, unknown>, headers: Record<string, string>): { status: number; json: unknown } => {
    if (headers["x-app-key"] !== KEY) return { status: 403, json: { error: "This app isn't connected to a backend." } }
    switch (body.op) {
      case "list":
        return { status: 200, json: { result: body.collection === "tasks" ? tasks : [] } }
      case "settings":
        return { status: 200, json: { result: {} } }
      case "auth.current":
        return { status: 200, json: { result: headers["x-app-session"] === "tok" ? user : null } }
      case "insert": {
        const rec = { ...(body.values as object), id: `t${tasks.length + 1}` } as Rec
        tasks.unshift(rec)
        return { status: 200, json: { result: rec } }
      }
      case "auth.signIn":
        user = { id: "u1", name: "Sam", email: String(body.email) }
        return { status: 200, json: { result: { token: "tok", user } } }
      default:
        return { status: 400, json: { error: "Unknown operation." } }
    }
  }
  return { calls, tasks, handle }
}

/** A minimal stand-in for the Axios instance the generated module creates and calls (.post), driven by `server`. */
function fakeAxios(server: ReturnType<typeof fakeServer>) {
  class FakeAxiosError extends Error {
    response?: { status: number; data: unknown }
  }
  let defaultHeaders: Record<string, string> = {}
  const instance = {
    post: async (_url: string, body: Record<string, unknown>, config: { headers: Record<string, string> }) => {
      const headers = { ...defaultHeaders, ...config.headers }
      server.calls.push({ op: String(body.op), headers, body })
      const r = server.handle(body, headers)
      if (r.status >= 400) {
        const e = new FakeAxiosError("Request failed")
        e.response = { status: r.status, data: r.json }
        throw e
      }
      return { data: r.json, status: r.status }
    },
  }
  return {
    create: (config: { baseURL: string; headers: Record<string, string> }) => {
      defaultHeaders = config.headers
      return instance
    },
    isAxiosError: (e: unknown): e is InstanceType<typeof FakeAxiosError> => e instanceof FakeAxiosError,
  }
}

function loadBackend(server: ReturnType<typeof fakeServer>): Backend {
  const { code } = transform(backendRemote("p1"), { transforms: ["typescript", "imports"], production: true, filePath: "lib/backend/index.ts" })
  const stored = new Map<string, string>()
  const asyncStorage = {
    getItem: async (k: string) => stored.get(k) ?? null,
    setItem: async (k: string, v: string) => void stored.set(k, v),
    removeItem: async (k: string) => void stored.delete(k),
  }
  const fakeRequire = (spec: string) => {
    if (spec === "react-native") return { AppState: { addEventListener: () => {}, currentState: "active" } }
    if (spec === "@react-native-async-storage/async-storage") return { default: asyncStorage, __esModule: true }
    if (spec === "axios") return { default: fakeAxios(server), __esModule: true }
    if (spec === "@tanstack/react-query") return { QueryClient, focusManager, useQuery, useMutation }
    if (spec === "@/data/seed.json") return { default: { user: { name: "Sample User" } }, __esModule: true }
    if (spec === "./config") return { API_URL: ENDPOINT, APP_KEY: KEY }
    throw new Error(`unexpected require: ${spec}`)
  }
  const mod = { exports: {} as Backend }
  new Function("require", "module", "exports", code)(fakeRequire, mod, mod.exports)
  return mod.exports
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))))

describe("backendRemote() under a real React root", () => {
  let container: HTMLDivElement
  let root: Root
  let server: ReturnType<typeof fakeServer>

  beforeEach(() => {
    server = fakeServer()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("shows the collection from the server, sending the app key", async () => {
    const backend = loadBackend(server)
    function Probe() {
      const { data, loading } = backend.useCollection("tasks")
      return React.createElement("div", null, loading ? "loading" : data.map((t) => t.title).join(","))
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()

    expect(container.textContent).toBe("Existing")
    const call = server.calls.find((c) => c.op === "list")!
    expect(call.body.collection).toBe("tasks")
    expect(call.headers["x-app-key"]).toBe(KEY)
  })

  it("two different collections are fetched independently, each with its own list call", async () => {
    const backend = loadBackend(server)
    function Probe() {
      backend.useCollection("tasks")
      backend.useCollection("notes")
      return null
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()
    const collections = server.calls.filter((c) => c.op === "list").map((c) => c.body.collection)
    expect(collections).toContain("tasks")
    expect(collections).toContain("notes")
  })

  it("shows an inserted record straight away", async () => {
    const backend = loadBackend(server)
    function Probe() {
      const { data, insert } = backend.useCollection("tasks")
      return React.createElement("button", { onClick: () => void insert({ title: "New task" }) }, data.map((t) => t.title).join(","))
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()
    await act(async () => {
      container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await settle()

    expect(container.textContent).toBe("New task,Existing")
    expect(server.calls.some((c) => c.op === "insert" && (c.body.values as { title: string }).title === "New task")).toBe(true)
  })

  it("after signing in, calls carry the user's session and useUser reflects it", async () => {
    const backend = loadBackend(server)
    function Probe() {
      const { user, signedIn } = backend.useUser()
      return React.createElement("div", null, signedIn ? `in:${user.name}` : `out:${user.name}`)
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()
    expect(container.textContent).toBe("out:Sample User")

    await act(async () => void (await backend.auth.signIn({ email: "s@x.io", password: "pw" })))
    await settle()

    expect(container.textContent).toBe("in:Sam")
    expect(server.calls.at(-1)!.headers["x-app-session"]).toBe("tok")
  })

  it("a backend refusal doesn't crash the screen; it shows no data instead", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    server.handle = () => ({ status: 403, json: { error: "nope" } })
    const backend = loadBackend(server)
    function Probe() {
      const { data, loading } = backend.useCollection("tasks")
      return React.createElement("div", null, loading ? "loading" : `ready:${data.length}`)
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()
    expect(container.textContent).toBe("ready:0")
  })
})

describe("backendConfig / remoteBackendFiles", () => {
  it("bakes in the endpoint and key, and lets EXPO_PUBLIC_* override them", () => {
    const cfg = backendConfig(ENDPOINT, "k1")
    expect(cfg).toContain(`process.env.EXPO_PUBLIC_API_URL || "${ENDPOINT}"`)
    expect(cfg).toContain('process.env.EXPO_PUBLIC_APP_KEY || "k1"')
  })

  it("replaces the on-device backend module and adds the config next to it", () => {
    const files = remoteBackendFiles("p1", "https://x/data", "k1")
    expect(Object.keys(files).sort()).toEqual(["lib/backend/config.ts", "lib/backend/index.ts"])
    expect(files["lib/backend/index.ts"]).toContain('"app:p1:session"')
  })
})

describe("withRemoteBackendDeps", () => {
  it("adds axios and react-query to an existing package.json's dependencies", () => {
    const pkg = JSON.stringify({ name: "x", dependencies: { react: "19.3.0" } })
    const out = JSON.parse(withRemoteBackendDeps(pkg))
    expect(out.dependencies.react).toBe("19.3.0")
    expect(out.dependencies.axios).toBeTruthy()
    expect(out.dependencies["@tanstack/react-query"]).toBeTruthy()
  })

  it("leaves malformed input untouched instead of throwing", () => {
    expect(withRemoteBackendDeps("not json")).toBe("not json")
  })
})
