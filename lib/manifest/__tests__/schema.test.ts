import { describe, expect, it } from "vitest"
import { applyPatch, validateManifest, type AppManifest } from "@/lib/manifest/schema"

const base: AppManifest = {
  schemaVersion: 1,
  app: { name: "Habit Tracker", slug: "habit-tracker" },
  screens: {
    home: { title: "Home", presentation: "tab", icon: "home-outline" },
    profile: { title: "Profile", presentation: "tab", icon: "person-outline" },
    "habit-detail": { title: "Habit", presentation: "stack", params: { id: "string" }, collection: "habits" },
  },
  navigation: { tabs: ["home", "profile"], initial: "home" },
  collections: {
    habits: { label: "Habits", fields: { title: { type: "string" } }, seed: [{ id: "h1", title: "Drink water" }] },
  },
  allowedPackages: ["react", "react-native"],
}

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    const { manifest, diagnostics } = validateManifest(base)
    expect(diagnostics).toEqual([])
    expect(manifest?.app.name).toBe("Habit Tracker")
  })

  it("rejects a tab that isn't a screen", () => {
    const { manifest, diagnostics } = validateManifest({ ...base, navigation: { tabs: ["home", "missing"], initial: "home" } })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "unknown_screen")).toBe(true)
  })

  it("rejects a tab screen that declares params", () => {
    const { manifest, diagnostics } = validateManifest({
      ...base,
      screens: { ...base.screens, home: { title: "Home", presentation: "tab", icon: "home-outline", params: { id: "string" } } },
    })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "tab_params")).toBe(true)
  })

  it("rejects a tab screen with no icon", () => {
    const { manifest, diagnostics } = validateManifest({ ...base, screens: { ...base.screens, home: { title: "Home", presentation: "tab" } } })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "missing_icon")).toBe(true)
  })

  it("rejects an icon outside the icon vocabulary", () => {
    const { manifest, diagnostics } = validateManifest({ ...base, screens: { ...base.screens, home: { title: "Home", presentation: "tab", icon: "not-a-real-icon" } } })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "unknown_icon")).toBe(true)
  })

  it("rejects a screen referring to a collection that doesn't exist", () => {
    const { manifest, diagnostics } = validateManifest({
      ...base,
      screens: { ...base.screens, "habit-detail": { ...base.screens["habit-detail"], collection: "nope" } },
    })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "unknown_collection")).toBe(true)
  })

  it("rejects a reserved field name on a collection", () => {
    const { manifest, diagnostics } = validateManifest({
      ...base,
      collections: { habits: { label: "Habits", fields: { id: { type: "string" } }, seed: [] } },
    })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "reserved_field")).toBe(true)
  })

  it("rejects a seed row with a field the collection doesn't declare", () => {
    const { manifest, diagnostics } = validateManifest({
      ...base,
      collections: { habits: { label: "Habits", fields: { title: { type: "string" } }, seed: [{ id: "h1", bogus: 1 }] } },
    })
    expect(manifest).toBeUndefined()
    expect(diagnostics.some((d) => d.code === "unknown_field")).toBe(true)
  })

  it("rejects exactly one tab", () => {
    const { manifest, diagnostics } = validateManifest({
      ...base,
      screens: { ...base.screens, home: { title: "Home", presentation: "tab", icon: "home-outline" } },
      navigation: { tabs: ["home"], initial: "home" },
    })
    expect(diagnostics.some((d) => d.code === "tab_count")).toBe(true)
    expect(manifest).toBeUndefined()
  })

  it("rejects malformed input with a schema diagnostic instead of throwing", () => {
    const { manifest, diagnostics } = validateManifest({ not: "a manifest" })
    expect(manifest).toBeUndefined()
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0].code).toBe("schema")
  })
})

describe("applyPatch", () => {
  it("adds a new screen", () => {
    const { doc, error } = applyPatch(base, [{ op: "add", path: "/screens/settings", value: { title: "Settings", presentation: "stack" } }])
    expect(error).toBeUndefined()
    expect(doc?.screens.settings).toEqual({ title: "Settings", presentation: "stack" })
  })

  it("replaces a screen's title", () => {
    const { doc } = applyPatch(base, [{ op: "replace", path: "/screens/home/title", value: "Dashboard" }])
    expect(doc?.screens.home.title).toBe("Dashboard")
  })

  it("removes a screen", () => {
    const { doc } = applyPatch(base, [{ op: "remove", path: "/screens/habit-detail" }])
    expect(doc?.screens["habit-detail"]).toBeUndefined()
  })

  it("appends to an array with the '-' index", () => {
    const { doc } = applyPatch(base, [{ op: "add", path: "/navigation/tabs/-", value: "settings" }])
    expect(doc?.navigation.tabs).toEqual(["home", "profile", "settings"])
  })

  it("errors on a path that doesn't exist", () => {
    const { doc, error } = applyPatch(base, [{ op: "replace", path: "/screens/nope/title", value: "x" }])
    expect(doc).toBeUndefined()
    expect(error).toMatch(/does not exist/)
  })

  it("never mutates the original doc", () => {
    const before = JSON.stringify(base)
    applyPatch(base, [{ op: "remove", path: "/screens/home" }])
    expect(JSON.stringify(base)).toBe(before)
  })
})
