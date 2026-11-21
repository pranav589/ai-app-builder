import { describe, expect, it } from "vitest"
import { compileManifest } from "@app/shared/manifest/compile"
import type { AppManifest } from "@app/shared/manifest/schema"

const manifest: AppManifest = {
  schemaVersion: 1,
  app: { name: "Habit Tracker", slug: "habit-tracker" },
  screens: {
    home: { title: "Home", presentation: "tab", icon: "home-outline" },
    profile: { title: "Profile", presentation: "tab", icon: "person-outline" },
    "habit-detail": { title: "Habit", presentation: "stack", params: { id: "string" }, collection: "habits" },
    "add-habit": { title: "Add Habit", presentation: "modal" },
  },
  navigation: { tabs: ["home", "profile"], initial: "home" },
  collections: {
    habits: {
      label: "Habits",
      fields: { title: { type: "string" }, streak: { type: "number" } },
      seed: [{ id: "h1", title: "Drink water", streak: 3 }],
    },
  },
  allowedPackages: ["react", "react-native"],
}

describe("compileManifest", () => {
  const out = compileManifest(manifest)

  it("writes exactly the compiler-owned paths (plus the tabs layout, since this manifest has tabs)", () => {
    expect(Object.keys(out).sort()).toEqual(["app/(tabs)/_layout.tsx", "app/_layout.tsx", "app/index.tsx", "data/types.ts", "lib/nav.ts"])
  })

  it("omits the tabs layout when there are no tabs", () => {
    const noTabs = compileManifest({ ...manifest, navigation: { tabs: [], initial: "habit-detail" } })
    expect(Object.keys(noTabs)).not.toContain("app/(tabs)/_layout.tsx")
  })

  it("app/_layout.tsx lists every modal screen and nothing else", () => {
    const code = out["app/_layout.tsx"]
    expect(code).toContain('<Stack.Screen name="add-habit" options={{ presentation: "modal" }} />')
    expect(code).not.toContain("habit-detail")
    expect(code).not.toContain("home")
  })

  it("app/(tabs)/_layout.tsx lists tabs in manifest order with their icons", () => {
    const code = out["app/(tabs)/_layout.tsx"]
    const homeIdx = code.indexOf('name="home"')
    const profileIdx = code.indexOf('name="profile"')
    expect(homeIdx).toBeGreaterThanOrEqual(0)
    expect(profileIdx).toBeGreaterThan(homeIdx)
    expect(code).toContain('sf={{ default: "house"')
  })

  it("app/index.tsx redirects to the initial screen", () => {
    expect(out["app/index.tsx"]).toContain('href="/home"')
  })

  it("lib/nav.ts types params per screen and gives a non-tab screen's params as required", () => {
    const code = out["lib/nav.ts"]
    expect(code).toContain('"home": undefined')
    expect(code).toContain('"habit-detail": { "id": string }')
    expect(code).toContain("export function go(")
    expect(code).toContain("export function useParams<")
  })

  it("data/types.ts has a type for each collection", () => {
    expect(out["data/types.ts"]).toContain("export type Habit = {")
  })

  it("every compiler-written file starts with the generated-file header (data/types.ts has its own, shared with lib/app-project/templates.ts's generator)", () => {
    for (const [path, code] of Object.entries(out)) {
      if (path === "data/types.ts") expect(code.startsWith("// Generated from")).toBe(true)
      else expect(code.startsWith("// @generated")).toBe(true)
    }
  })
})

describe("compileManifest determinism", () => {
  it("produces byte-identical output for the same manifest", () => {
    const a = compileManifest(manifest)
    const b = compileManifest(structuredClone(manifest))
    expect(a).toEqual(b)
  })

  it("doesn't depend on key order in the manifest's objects", () => {
    const reordered: AppManifest = {
      ...manifest,
      screens: { "add-habit": manifest.screens["add-habit"], home: manifest.screens.home, profile: manifest.screens.profile, "habit-detail": manifest.screens["habit-detail"] },
    }
    expect(compileManifest(reordered)).toEqual(compileManifest(manifest))
  })
})
