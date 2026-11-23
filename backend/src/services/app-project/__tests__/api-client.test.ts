// Loads the generated lib/api.ts for real (sucrase-transformed, then run in
// Node with a fake AsyncStorage and a fake axios adapter), the same approach
// backend-remote.test.ts uses: this exercises the actual interceptor logic,
// not just the source text.
import { describe, expect, it } from "vitest"
import { transform } from "sucrase"
import axios from "axios"

import { apiClientFiles, apiClientSource, apiConfig, withApiClientDeps } from "../api-client"

const ENDPOINT = "https://builder.example/api/app-runtime/p1"
const KEY = "app-key-123"

type Call = { url?: string; headers: Record<string, string>; data: unknown }

function loadApiModule() {
  const { code } = transform(apiClientSource("p1"), { transforms: ["typescript", "imports"], production: true, filePath: "lib/api.ts" })
  const stored = new Map<string, string>()
  const asyncStorage = {
    getItem: async (k: string) => stored.get(k) ?? null,
    setItem: async (k: string, v: string) => void stored.set(k, v),
    removeItem: async (k: string) => void stored.delete(k),
  }
  const calls: Call[] = []
  const fakeRequire = (spec: string) => {
    if (spec === "axios") {
      const instance = {
        create: (opts: { baseURL: string; headers: Record<string, string> }) =>
          axios.create({
            ...opts,
            adapter: async (config) => {
              calls.push({ url: config.url, headers: config.headers as unknown as Record<string, string>, data: config.data })
              const url = config.url ?? ""
              let data: unknown = { ok: true }
              if (url === "/auth/sign-in") data = { token: "tok", user: { id: "u1" } }
              if (url === "/auth/sign-out") data = null
              return { data, status: 200, statusText: "OK", headers: {}, config }
            },
          }),
      }
      return Object.assign({}, axios, instance)
    }
    if (spec === "@tanstack/react-query") return { QueryClient: class {} }
    if (spec === "@react-native-async-storage/async-storage") return { default: asyncStorage, __esModule: true }
    if (spec === "./api-config") return { API_URL: ENDPOINT, APP_KEY: KEY }
    throw new Error(`unexpected require: ${spec}`)
  }
  const mod = { exports: {} as { api: import("axios").AxiosInstance } }
  new Function("require", "module", "exports", code)(fakeRequire, mod, mod.exports)
  return { ...mod.exports, calls }
}

describe("apiConfig / apiClientFiles", () => {
  it("bakes in the endpoint and key, and lets EXPO_PUBLIC_* override them", () => {
    const cfg = apiConfig(ENDPOINT, KEY)
    expect(cfg).toContain(`process.env.EXPO_PUBLIC_API_URL || "${ENDPOINT}"`)
    expect(cfg).toContain(`process.env.EXPO_PUBLIC_APP_KEY || "${KEY}"`)
  })

  it("writes both files, with the session key namespaced per app", () => {
    const files = apiClientFiles("p1", ENDPOINT, KEY)
    expect(Object.keys(files).sort()).toEqual(["lib/api-config.ts", "lib/api.ts"])
    expect(files["lib/api.ts"]).toContain('"app:p1:session"')
  })
})

describe("withApiClientDeps", () => {
  it("adds axios and react-query to an existing package.json's dependencies", () => {
    const pkg = JSON.stringify({ name: "x", dependencies: { react: "19.3.0" } })
    const out = JSON.parse(withApiClientDeps(pkg))
    expect(out.dependencies.react).toBe("19.3.0")
    expect(out.dependencies.axios).toBeTruthy()
    expect(out.dependencies["@tanstack/react-query"]).toBeTruthy()
  })

  it("leaves malformed input untouched instead of throwing", () => {
    expect(withApiClientDeps("not json")).toBe("not json")
  })
})

describe("the generated api client", () => {
  it("sends the app key on every call", async () => {
    const { api, calls } = loadApiModule()
    await api.get("/collections/tasks")
    expect(calls[0].headers["x-app-key"]).toBe(KEY)
  })

  it("persists the session after sign-in and sends it on the next call", async () => {
    const { api, calls } = loadApiModule()
    await api.post("/auth/sign-in", { email: "a@b.com", password: "pw" })
    await api.get("/collections/tasks")
    expect(calls[1].headers["x-app-session"]).toBe("tok")
  })

  it("clears the stored session after sign-out", async () => {
    const { api, calls } = loadApiModule()
    await api.post("/auth/sign-in", {})
    await api.post("/auth/sign-out")
    await api.get("/collections/tasks")
    expect(calls[2].headers["x-app-session"]).toBe("")
  })
})
