import { describe, expect, it } from "vitest"
import { typecheckGate } from "@/lib/verify/gates/typecheck"
import type { Workspace } from "@app/shared/verify/types"
import { platformFiles } from "@/lib/app-project/templates"
import { fallbackThemes } from "@app/shared/app-runtime/theme"
import { normalizeDataModel } from "@app/shared/app-runtime/data-model"
import type { AppPlan } from "@app/shared/agent/types"

const plan: AppPlan = {
  appName: "Test App",
  summary: "A test app.",
  targetUsers: "Testers.",
  coreFeatures: ["Habits"],
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
  screens: [{ id: "home", name: "Home", purpose: "Show habits", keyElements: [], navigatesTo: ["habit-detail"], presentation: "tab" }],
}

const data = normalizeDataModel(
  {
    collections: [
      {
        name: "habits",
        label: "Habits",
        fields: [
          { name: "title", type: "string" },
          { name: "streak", type: "number" },
        ],
        seed: [{ id: "h1", title: "Drink water", streak: 3, createdAt: "2026-01-01" }],
      },
    ],
    settings: {},
    user: { name: "Alex", email: "alex@example.com" },
  },
  "test-hash"
)

/** A realistic base workspace: the generated platform files plus one screen, so an import like @/theme resolves for real. */
function baseWorkspace(screenCode: string): Workspace {
  const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t" }, data)
  return { files: { ...files, "app/home.tsx": screenCode } }
}

/** Same, but with a small AI-written Zustand store too, as a real screen would have -- @/data/types still comes from platformFiles(). */
const HABITS_STORE = `import { create } from "zustand"
import type { Habit } from "@/data/types"

type Store = { habits: Habit[] }
export const useHabitsStore = create<Store>(() => ({ habits: [] }))
export const useHabit = (id: string) => useHabitsStore((s) => s.habits.find((h) => h.id === id))
`
function workspaceWithStore(screenCode: string): Workspace {
  const ws = baseWorkspace(screenCode)
  return { files: { ...ws.files, "stores/useHabitsStore.ts": HABITS_STORE } }
}

const PROJECT_KEY = "typecheck-test"

describe("typecheckGate", () => {
  it("passes a correct screen", () => {
    const code = `import { View, Text } from "react-native"
import { useHabitsStore } from "@/stores/useHabitsStore"

export default function Home() {
  const habits = useHabitsStore((s) => s.habits)
  return (
    <View>
      {habits.map((h) => (
        <Text key={h.id}>{h.title}</Text>
      ))}
    </View>
  )
}
`
    const r = typecheckGate(workspaceWithStore(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(true)
  })

  it("flags a wrong prop on a React Native component", () => {
    const code = `import { View } from "react-native"

export default function Home() {
  return <View notARealProp="x" />
}
`
    const r = typecheckGate(baseWorkspace(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true)
  })

  it("flags a missing import (a name used but never imported or declared)", () => {
    const code = `export default function Home() {
  return <View />
}
`
    const r = typecheckGate(baseWorkspace(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "TS2304")).toBe(true)
  })

  it("flags an import from a module that doesn't exist", () => {
    const code = `import { Foo } from "left-pad"
export default function Home() {
  return null
}
`
    const r = typecheckGate(baseWorkspace(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "TS2307")).toBe(true)
  })

  it("flags an unknown collection field", () => {
    const code = `import { Text } from "react-native"
import { useHabitsStore } from "@/stores/useHabitsStore"

export default function Home() {
  const habits = useHabitsStore((s) => s.habits)
  return <Text>{habits[0]?.notAField}</Text>
}
`
    const r = typecheckGate(workspaceWithStore(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "TS2339")).toBe(true)
  })

  it("flags an unchecked lookup-by-id null access", () => {
    const code = `import { Text } from "react-native"
import { useHabit } from "@/stores/useHabitsStore"

export default function Home() {
  const habit = useHabit("h1")
  return <Text>{habit.title}</Text>
}
`
    const r = typecheckGate(workspaceWithStore(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "TS18048" || d.code === "TS2339")).toBe(true)
  })

  it("passes when the lookup's undefined case is handled", () => {
    const code = `import { Text } from "react-native"
import { useHabit } from "@/stores/useHabitsStore"

export default function Home() {
  const habit = useHabit("h1")
  if (!habit) return <Text>Not found</Text>
  return <Text>{habit.title}</Text>
}
`
    const r = typecheckGate(workspaceWithStore(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(true)
  })

  it("flags a wrong router.push argument type", () => {
    const code = `import { router } from "expo-router"
import { Text } from "react-native"

export default function Home() {
  router.push(42)
  return <Text>Home</Text>
}
`
    const r = typecheckGate(baseWorkspace(code), ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true)
  })

  it("ignores a pre-existing error in a file this change didn't touch", () => {
    const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t" }, data)
    const broken: Workspace = {
      files: {
        ...files,
        "app/old.tsx": `import { View } from "react-native"\nexport default function Old() {\n  return <View notARealProp="x" />\n}\n`,
        "app/home.tsx": `import { View } from "react-native"\nexport default function Home() {\n  return <View />\n}\n`,
      },
    }
    const r = typecheckGate(broken, ["app/home.tsx"], PROJECT_KEY)
    expect(r.ok).toBe(true)
  })

  it("re-checks warm in well under the CI bound", () => {
    const code = `import { View, Text } from "react-native"
export default function Home() {
  return (
    <View>
      <Text>Hello</Text>
    </View>
  )
}
`
    const ws = baseWorkspace(code)
    typecheckGate(ws, ["app/home.tsx"], PROJECT_KEY) // warm the service
    const t0 = performance.now()
    const r = typecheckGate(ws, ["app/home.tsx"], PROJECT_KEY)
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(r.ok).toBe(true)
  })
})
