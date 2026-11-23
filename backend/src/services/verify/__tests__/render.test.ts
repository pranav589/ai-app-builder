import { describe, expect, it } from "vitest"
import { renderGate } from "@/lib/verify/gates/render"
import type { Workspace } from "@app/shared/verify/types"
import { platformFiles } from "@/lib/app-project/templates"
import { fallbackThemes } from "@app/shared/app-runtime/theme"
import { normalizeDataModel } from "@app/shared/app-runtime/data-model"
import type { AppPlan } from "@app/shared/agent/types"
import { compileManifest } from "@app/shared/manifest/compile"
import type { AppManifest } from "@app/shared/manifest/schema"

const plan: AppPlan = {
  appName: "Render Test App",
  summary: "A test app.",
  targetUsers: "Testers.",
  coreFeatures: ["Items"],
  navigation: "A single tab.",
  design: {
    style: "Clean",
    primaryColor: "#4f46e5",
    accentColor: "#f59e0b",
    backgroundColor: "#f6f7f9",
    surfaceColor: "#ffffff",
    textColor: "#111111",
    cornerRadius: "soft",
    typography: "System",
  },
  screens: [{ id: "home", name: "Home", purpose: "Show items", keyElements: [], navigatesTo: [], presentation: "tab" }],
}

const data = normalizeDataModel(
  {
    collections: [{ name: "items", label: "Items", fields: [{ name: "title", type: "string" }], seed: [{ id: "i1", title: "First", createdAt: "2026-01-01" }] }],
    settings: {},
    user: { name: "Alex", email: "alex@example.com" },
  },
  "test-hash"
)

function baseWorkspace(screenCode: string, screenPath = "app/home.tsx"): Workspace {
  const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t" }, data)
  return { files: { ...files, [screenPath]: screenCode } }
}

describe("renderGate", () => {
  it("passes a valid screen", async () => {
    const code = `import { View, Text } from "react-native"
export default function Home() {
  return (
    <View>
      <Text>Hello</Text>
    </View>
  )
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  // Regression: react-native-web's Animated referenced a bare `global`, which
  // esbuild's platform:"browser" bundle (scripts/build-preview.mjs) doesn't
  // define -- any screen using Animated.timing threw "global is not defined"
  // the moment it actually ran, in this gate and in the real preview iframe
  // alike (both load the same built public/preview/runtime.js). Fixed by
  // adding `define: { global: "globalThis" }` to the esbuild options.
  it("passes a screen that animates a value with Animated.timing", async () => {
    const code = `import { useEffect, useRef } from "react"
import { Animated, Text, View } from "react-native"
export default function Home() {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 100, useNativeDriver: false }).start()
  }, [v])
  return (
    <View>
      <Text>Progress</Text>
      <Animated.View style={{ opacity: v, width: 10, height: 10, backgroundColor: "#000" }} />
    </View>
  )
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  it("rejects a screen that throws on mount", async () => {
    const code = `export default function Home() {
  throw new Error("boom on mount")
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "render_error" && d.message.includes("boom on mount"))).toBe(true)
  }, 15000)

  it("rejects a screen that throws when the record is missing", async () => {
    const code = `import { Text } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useRecord } from "@/lib/backend"

export default function Home() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { data } = useRecord("items", id)
  return <Text>{data.title}</Text>
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "render_error")).toBe(true)
  }, 15000)

  it("passes when the missing-record case is handled", async () => {
    const code = `import { Text } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useRecord } from "@/lib/backend"

export default function Home() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { data } = useRecord("items", id)
  if (!data) return <Text>Not found</Text>
  return <Text>{data.title}</Text>
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  // The replacement for the @/lib/backend tests above: a real Zustand store
  // (no platform file -- the AI writes this itself), persisted through
  // @react-native-async-storage/async-storage, which the preview bundle
  // backs with the real zustand package, not a stand-in.
  it("mounts a screen reading from an AI-written Zustand store", async () => {
    const store = `import { create } from "zustand"
type Item = { id: string; title: string }
type Store = { items: Item[] }
export const useItemsStore = create<Store>(() => ({ items: [{ id: "i1", title: "First" }] }))
`
    const code = `import { Text, View } from "react-native"
import { useItemsStore } from "@/stores/useItemsStore"
export default function Home() {
  const items = useItemsStore((s) => s.items)
  return (
    <View>
      {items.map((i) => <Text key={i.id}>{i.title}</Text>)}
    </View>
  )
}
`
    const ws = baseWorkspace(code)
    const r = await renderGate({ files: { ...ws.files, "stores/useItemsStore.ts": store } }, ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  it("mounts a screen reading from @/lib/api with React Query, and survives pressing its insert button", async () => {
    const code = `import { Text, View, Pressable } from "react-native"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
export default function Home() {
  const qc = useQueryClient()
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: () => api.get("/collections/items").then((r) => r.data) })
  const insert = useMutation({
    mutationFn: (title: string) => api.post("/collections/items", { title }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  })
  return (
    <View>
      {items.map((i: { id: string; title: string }) => <Text key={i.id}>{i.title}</Text>)}
      <Pressable onPress={() => insert.mutate("New item")}><Text>Add</Text></Pressable>
    </View>
  )
}
`
    // useQuery/useMutation read their QueryClient from context (no client passed explicitly,
    // same as the real backend-conversion prompt writes), so this needs the real compiled
    // root layout: only compileManifest's connected:true output wraps the app in
    // QueryClientProvider (shared/manifest/compile.ts rootLayoutFile).
    const manifest: AppManifest = {
      schemaVersion: 1,
      app: { name: plan.appName, slug: "render-test-app" },
      screens: { home: { title: "Home", presentation: "tab", icon: "home-outline" } },
      navigation: { tabs: ["home"], initial: "home" },
      collections: { items: { label: "Items", fields: { title: { type: "string" } }, seed: data.collections[0].seed } },
      allowedPackages: [],
    }
    const ws = baseWorkspace(code)
    const r = await renderGate({ files: { ...ws.files, ...compileManifest(manifest, { connected: true }) } }, ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  it("rejects a Zustand-backed lookup-by-id accessed without checking it's found", async () => {
    const store = `import { create } from "zustand"
type Item = { id: string; title: string }
type Store = { items: Item[] }
export const useItemsStore = create<Store>(() => ({ items: [] }))
export const useItem = (id: string) => useItemsStore((s) => s.items.find((i) => i.id === id))
`
    const code = `import { Text } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { useItem } from "@/stores/useItemsStore"
export default function Home() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const item = useItem(id ?? "")
  return <Text>{item.title}</Text>
}
`
    const ws = baseWorkspace(code)
    const r = await renderGate({ files: { ...ws.files, "stores/useItemsStore.ts": store } }, ["app/home.tsx"])
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "render_error")).toBe(true)
  }, 15000)

  it("rejects a render loop (setState called unconditionally during render)", async () => {
    const code = `import { useState } from "react"
import { Text } from "react-native"
export default function Home() {
  const [n, setN] = useState(0)
  setN(n + 1)
  return <Text>{n}</Text>
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true)
  }, 15000)

  it("rejects a screen that renders nothing", async () => {
    const code = `export default function Home() {
  return null
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "blank_screen")).toBe(true)
  }, 15000)

  it("rejects a screen that crashes on a button press", async () => {
    const code = `import { Pressable, Text } from "react-native"
export default function Home() {
  return (
    <Pressable role="button" aria-label="Boom" onPress={() => { throw new Error("press boom") }}>
      <Text>Boom</Text>
    </Pressable>
  )
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "press_error" && d.message.includes("press boom"))).toBe(true)
  }, 15000)

  it("ignores a screen this change didn't touch", async () => {
    const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t" }, data)
    const ws: Workspace = {
      files: {
        ...files,
        "app/broken.tsx": `export default function Broken() { throw new Error("pre-existing") }`,
        "app/home.tsx": `import { Text } from "react-native"\nexport default function Home() { return <Text>Fine</Text> }`,
      },
    }
    const r = await renderGate(ws, ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  it("VERIFY_DEBUG_INJECT=crash blocks an otherwise-valid screen, outside production", async () => {
    const code = `import { Text } from "react-native"
export default function Home() {
  return <Text>Fine</Text>
}
`
    const env = process.env as Record<string, string | undefined>
    const prevInject = env.VERIFY_DEBUG_INJECT
    const prevEnv = env.NODE_ENV
    env.VERIFY_DEBUG_INJECT = "crash"
    env.NODE_ENV = "test"
    try {
      const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
      expect(r.ok).toBe(false)
    } finally {
      env.VERIFY_DEBUG_INJECT = prevInject
      env.NODE_ENV = prevEnv
    }
  }, 15000)

  it("VERIFY_DEBUG_INJECT=crash is ignored in production", async () => {
    const code = `import { Text } from "react-native"
export default function Home() {
  return <Text>Fine</Text>
}
`
    const env = process.env as Record<string, string | undefined>
    const prevInject = env.VERIFY_DEBUG_INJECT
    const prevEnv = env.NODE_ENV
    env.VERIFY_DEBUG_INJECT = "crash"
    env.NODE_ENV = "production"
    try {
      const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
      expect(r.ok).toBe(true)
    } finally {
      env.VERIFY_DEBUG_INJECT = prevInject
      env.NODE_ENV = prevEnv
    }
  }, 15000)
})
