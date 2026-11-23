// @vitest-environment jsdom
//
// Mounts the generated remote backend (the one an app gets once its creator
// connected a backend provider) under a real React root with a fake server behind
// fetch, the same way backend-device.test.ts does for the local one: hooks
// must show server data, reflect writes at once, and carry the app key and the
// signed-in user's session on every call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { transform } from "sucrase"
import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"

import { backendConfig, backendRemote, remoteBackendFiles } from "../backend-remote"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Rec = { id: string; title?: string }
type Backend = {
  useCollection: (c: string) => { data: Rec[]; loading: boolean; insert: (v: Record<string, unknown>) => Promise<Rec> }
  useUser: () => { user: { name: string }; signedIn: boolean }
  auth: { signIn: (i: { email: string; password: string }) => Promise<unknown> }
}
type Call = { op: string; headers: Record<string, string>; body: Record<string, unknown> }
type FetchInit = { headers: Record<string, string>; body: string }

const KEY = "app-key-123"
const ENDPOINT = "https://builder.example/api/app-runtime/p1/data"

function loadBackend(): Backend {
  const { code } = transform(backendRemote("p1"), { transforms: ["typescript", "imports"], production: true, filePath: "lib/backend/index.ts" })
  const stored = new Map<string, string>()
  const asyncStorage = {
    getItem: async (k: string) => stored.get(k) ?? null,
    setItem: async (k: string, v: string) => void stored.set(k, v),
    removeItem: async (k: string) => void stored.delete(k),
  }
  const fakeRequire = (spec: string) => {
    if (spec === "react") return React
    if (spec === "react-native") return { AppState: { currentState: "active" } }
    if (spec === "@react-native-async-storage/async-storage") return { default: asyncStorage, __esModule: true }
    if (spec === "@/data/seed.json") return { default: { user: { name: "Sample User" } }, __esModule: true }
    if (spec === "./config") return { API_URL: ENDPOINT, APP_KEY: KEY }
    throw new Error(`unexpected require: ${spec}`)
  }
  const mod = { exports: {} as Backend }
  new Function("require", "module", "exports", code)(fakeRequire, mod, mod.exports)
  return mod.exports
}

/** A stand-in for the backend route: tasks live in memory, sign-in returns a token. */
function fakeServer() {
  const calls: Call[] = []
  const tasks: Rec[] = [{ id: "t1", title: "Existing" }]
  let user: { id: string; name: string; email: string } | null = null
  let version = 1
  const handle = (body: Record<string, unknown>, headers: Record<string, string>): { status: number; json: unknown } => {
    if (headers["x-app-key"] !== KEY) return { status: 403, json: { error: "This app isn't connected to a backend." } }
    switch (body.op) {
      case "snapshot": {
        const collections = Object.fromEntries((body.collections as string[]).map((c) => [c, c === "tasks" ? tasks : []]))
        return { status: 200, json: { result: { collections, settings: {}, user: headers["x-app-session"] === "tok" ? user : null, version } } }
      }
      case "version":
        return { status: 200, json: { result: version } }
      case "insert": {
        const rec = { ...(body.values as object), id: `t${tasks.length + 1}` } as Rec
        tasks.unshift(rec)
        version++
        return { status: 200, json: { result: rec } }
      }
      case "auth.signIn":
        user = { id: "u1", name: "Sam", email: String(body.email) }
        return { status: 200, json: { result: { token: "tok", user } } }
      default:
        return { status: 400, json: { error: "Unknown operation." } }
    }
  }
  const fetchMock = vi.fn(async (url: string, init: FetchInit) => {
    expect(url).toBe(ENDPOINT)
    const body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ op: String(body.op), headers: init.headers, body })
    const r = handle(body, init.headers)
    return { ok: r.status < 400, status: r.status, json: async () => r.json }
  })
  return { calls, fetchMock }
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))))

describe("backendRemote() under a real React root", () => {
  let container: HTMLDivElement
  let root: Root
  let server: ReturnType<typeof fakeServer>

  beforeEach(() => {
    server = fakeServer()
    vi.stubGlobal("fetch", server.fetchMock)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("shows the collection from the server, sending the app key", async () => {
    const backend = loadBackend()
    function Probe() {
      const { data, loading } = backend.useCollection("tasks")
      return React.createElement("div", null, loading ? "loading" : data.map((t) => t.title).join(","))
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()

    expect(container.textContent).toBe("Existing")
    const snapshot = server.calls.find((c) => c.op === "snapshot")!
    expect(snapshot.body.collections).toEqual(["tasks"])
    expect(snapshot.headers["x-app-key"]).toBe(KEY)
  })

  it("two hooks mounted together are served by at most two snapshot requests, the last asking for both", async () => {
    const backend = loadBackend()
    function Probe() {
      backend.useCollection("tasks")
      backend.useCollection("notes")
      return null
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()
    const snapshots = server.calls.filter((c) => c.op === "snapshot")
    expect(snapshots.at(-1)!.body.collections).toEqual(["tasks", "notes"])
    expect(snapshots.length).toBeLessThanOrEqual(2)
  })

  it("shows an inserted record straight away", async () => {
    const backend = loadBackend()
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
    const backend = loadBackend()
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

  it("a backend refusal doesn't crash the screen; it stays on its loading state", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    server.fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: "nope" }) }))
    const backend = loadBackend()
    function Probe() {
      return React.createElement("div", null, backend.useCollection("tasks").loading ? "loading" : "ready")
    }
    await act(async () => void root.render(React.createElement(Probe)))
    await settle()
    expect(container.textContent).toBe("loading")
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
