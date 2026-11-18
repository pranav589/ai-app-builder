import { describe, expect, it } from "vitest"
import { addedScreensToPatch, ensureManifest, fromLegacy, syncManifest } from "@/lib/manifest/migrate"
import { applyPatch, validateManifest } from "@/lib/manifest/schema"
import type { AppPlan } from "@/lib/agent/types"
import type { AppDoc } from "@/lib/app-runtime/app-doc"

const plan: AppPlan = {
  appName: "Habit Tracker!",
  summary: "",
  targetUsers: "",
  coreFeatures: [],
  navigation: "",
  design: { style: "", primaryColor: "#000", accentColor: "#000", backgroundColor: "#000", surfaceColor: "#000", textColor: "#000", cornerRadius: "soft", typography: "" },
  screens: [
    { id: "home", name: "Home", purpose: "", keyElements: [], navigatesTo: ["habit-detail"], presentation: "tab" },
    { id: "profile", name: "Profile", purpose: "", keyElements: [], navigatesTo: [], presentation: "tab" },
    { id: "habit-detail", name: "Habit Detail", purpose: "Shows one habit", keyElements: [], navigatesTo: [], presentation: "stack" },
    { id: "add-habit", name: "Add Habit", purpose: "Create a habit", keyElements: [], navigatesTo: [], presentation: "modal" },
  ],
}

const doc: AppDoc = {
  v: 2,
  backend: { provider: "local" },
  screens: [
    { id: "home", name: "Home", state: "ready", code: "export default function Home() { return null }" },
    { id: "profile", name: "Profile", state: "ready", code: "export default function Profile() { return null }" },
    { id: "habit-detail", name: "Habit Detail", state: "ready", code: "export default function HabitDetail() { return null }" },
    { id: "add-habit", name: "Add Habit", state: "ready", code: "export default function AddHabit() { return null }" },
  ],
  data: {
    hash: "h",
    settings: {},
    user: { name: "Alex", email: "alex@example.com" },
    collections: [{ name: "habits", label: "Habits", fields: [{ name: "title", type: "string" }], seed: [{ id: "h1", title: "Drink water" }] }],
  },
}

describe("fromLegacy", () => {
  it("produces a manifest that passes validation", () => {
    const manifest = fromLegacy(plan, doc)
    const { diagnostics } = validateManifest(manifest)
    expect(diagnostics).toEqual([])
  })

  it("slugifies the app name", () => {
    expect(fromLegacy(plan, doc).app.slug).toBe("habit-tracker")
  })

  it("puts tab screens in navigation.tabs and sets the initial screen", () => {
    const m = fromLegacy(plan, doc)
    expect(m.navigation.tabs).toEqual(["home", "profile"])
    expect(m.navigation.initial).toBe("home")
  })

  it("gives a modal screen an id param", () => {
    const m = fromLegacy(plan, doc)
    expect(m.screens["add-habit"].params).toEqual({ id: "string" })
  })

  it("gives a screen that's a navigation target an id param", () => {
    const m = fromLegacy(plan, doc)
    expect(m.screens["habit-detail"].params).toEqual({ id: "string" })
  })

  it("doesn't give a tab screen params", () => {
    const m = fromLegacy(plan, doc)
    expect(m.screens.home.params).toBeUndefined()
  })

  it("guesses the collection a detail screen is about, by name", () => {
    const m = fromLegacy(plan, doc)
    expect(m.screens["habit-detail"].collection).toBe("habits")
  })

  it("carries the data model's collections across", () => {
    const m = fromLegacy(plan, doc)
    expect(m.collections.habits.fields.title.type).toBe("string")
    expect(m.collections.habits.seed).toEqual([{ id: "h1", title: "Drink water" }])
  })

  it("gives every tab screen a valid icon", () => {
    const m = fromLegacy(plan, doc)
    expect(m.screens.home.icon).toBeTruthy()
  })

  it("excludes a plan screen that was never actually built (real bug: a planned-but-unbuilt screen became a manifest entry with no file behind it)", () => {
    const planWithUnbuilt: AppPlan = { ...plan, screens: [...plan.screens, { id: "settings", name: "Settings", purpose: "", keyElements: [], navigatesTo: [], presentation: "stack" }] }
    const m = fromLegacy(planWithUnbuilt, doc)
    expect(m.screens.settings).toBeUndefined()
    expect(Object.keys(m.screens).sort()).toEqual(["add-habit", "habit-detail", "home", "profile"])
  })
})

describe("ensureManifest", () => {
  it("returns the doc's manifest when it already has one", () => {
    const existing = fromLegacy(plan, doc)
    expect(ensureManifest({ ...doc, manifest: existing }, plan)).toBe(existing)
  })

  it("migrates from the plan when there's no manifest yet", () => {
    const m = ensureManifest(doc, plan)
    expect(m?.app.name).toBe("Habit Tracker!")
  })

  it("returns undefined when there's neither a manifest nor a plan", () => {
    expect(ensureManifest(doc, null)).toBeUndefined()
  })
})

describe("addedScreensToPatch", () => {
  it("adds a stack screen that doesn't navigate anywhere special with no params", () => {
    const manifest = fromLegacy(plan, doc)
    const next: AppPlan = { ...plan, screens: [...plan.screens, { id: "about", name: "About", purpose: "", keyElements: [], navigatesTo: [], presentation: "stack" }] }
    const ops = addedScreensToPatch(manifest, plan, next)
    expect(ops).toEqual([{ op: "add", path: "/screens/about", value: { title: "About", presentation: "stack" } }])
  })

  it("adds a new tab screen to both /screens and navigation.tabs", () => {
    const manifest = fromLegacy(plan, doc)
    const next: AppPlan = { ...plan, screens: [...plan.screens, { id: "stats", name: "Stats", purpose: "", keyElements: [], navigatesTo: [], presentation: "tab" }] }
    const ops = addedScreensToPatch(manifest, plan, next)
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ op: "add", path: "/screens/stats" })
    expect(ops[1]).toEqual({ op: "add", path: "/navigation/tabs/-", value: "stats" })
    const applied = applyPatch(manifest, ops)
    expect(applied.error).toBeUndefined()
    const { diagnostics } = validateManifest(applied.doc)
    expect(diagnostics).toEqual([])
  })

  it("gives a modal screen an id param", () => {
    const manifest = fromLegacy(plan, doc)
    const next: AppPlan = { ...plan, screens: [...plan.screens, { id: "edit-habit", name: "Edit Habit", purpose: "", keyElements: [], navigatesTo: [], presentation: "modal" }] }
    const ops = addedScreensToPatch(manifest, plan, next)
    expect(ops[0]).toMatchObject({ value: { params: { id: "string" } } })
  })

  it("produces no ops when nothing was added", () => {
    const manifest = fromLegacy(plan, doc)
    expect(addedScreensToPatch(manifest, plan, plan)).toEqual([])
  })
})

describe("syncManifest", () => {
  it("builds fresh from the plan when the doc has no manifest yet", () => {
    const m = syncManifest(doc, plan)
    expect(m.app.name).toBe("Habit Tracker!")
    expect(Object.keys(m.screens).sort()).toEqual(["add-habit", "habit-detail", "home", "profile"])
  })

  it("keeps a manifest-only customization across a rebuild that adds a screen", () => {
    const existing = fromLegacy(plan, doc)
    const renamed = { ...existing, screens: { ...existing.screens, profile: { ...existing.screens.profile, title: "You" } } }
    const next: AppPlan = { ...plan, screens: [...plan.screens, { id: "stats", name: "Stats", purpose: "", keyElements: [], navigatesTo: [], presentation: "tab" }] }
    const m = syncManifest({ ...doc, manifest: renamed }, next)
    expect(m.screens.profile.title).toBe("You")
    expect(m.screens.stats).toBeTruthy()
    expect(m.navigation.tabs).toContain("stats")
    const { diagnostics } = validateManifest(m)
    expect(diagnostics).toEqual([])
  })

  it("drops a manifest screen the plan no longer has", () => {
    const existing = fromLegacy(plan, doc)
    const next: AppPlan = { ...plan, screens: plan.screens.filter((s) => s.id !== "add-habit") }
    const m = syncManifest({ ...doc, manifest: existing }, next)
    expect(m.screens["add-habit"]).toBeUndefined()
    expect(m.navigation.tabs).toEqual(["home", "profile"])
    const { diagnostics } = validateManifest(m)
    expect(diagnostics).toEqual([])
  })

  it("returns the manifest unchanged when the plan didn't add or remove screens", () => {
    const existing = fromLegacy(plan, doc)
    expect(syncManifest({ ...doc, manifest: existing }, plan)).toBe(existing)
  })
})
