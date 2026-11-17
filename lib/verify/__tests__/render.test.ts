import { describe, expect, it } from "vitest"
import { renderGate } from "@/lib/verify/gates/render"
import type { Workspace } from "@/lib/verify/types"
import { platformFiles } from "@/lib/app-project/templates"
import { fallbackThemes } from "@/lib/app-runtime/theme"
import { normalizeDataModel } from "@/lib/app-runtime/data-model"
import type { AppPlan } from "@/lib/agent/types"

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
