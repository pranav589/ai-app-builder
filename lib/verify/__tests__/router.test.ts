import { describe, expect, it } from "vitest"
import { parseRouterReply, routerPrompt } from "@/lib/verify/router"
import type { AppManifest } from "@/lib/manifest/schema"

const manifest: AppManifest = {
  schemaVersion: 1,
  app: { name: "Habit Tracker", slug: "habit-tracker" },
  screens: {
    home: { title: "Home", presentation: "tab", icon: "home-outline" },
    profile: { title: "Profile", presentation: "tab", icon: "person-outline" },
    "habit-detail": { title: "Habit Detail", presentation: "stack", params: { id: "string" }, collection: "habits" },
  },
  navigation: { tabs: ["home", "profile"], initial: "home" },
  collections: { habits: { label: "Habits", fields: { title: { type: "string" } }, seed: [] } },
  allowedPackages: [],
}

describe("parseRouterReply", () => {
  it("parses an edit route with targets", () => {
    const r = parseRouterReply("<route>edit</route>\n<targets>home, habit-detail</targets>")
    expect(r).toEqual({ route: "edit", targets: ["home", "habit-detail"], answer: undefined })
  })

  it("parses a question route with an answer and no targets", () => {
    const r = parseRouterReply("<route>question</route>\n<answer>You have Home, Profile and Habit Detail.</answer>")
    expect(r).toEqual({ route: "question", targets: [], answer: "You have Home, Profile and Habit Detail." })
  })

  it("parses add_screen and structure with no targets or answer needed", () => {
    expect(parseRouterReply("<route>add_screen</route>")).toEqual({ route: "add_screen", targets: [], answer: undefined })
    expect(parseRouterReply("<route>structure</route>")).toEqual({ route: "structure", targets: [], answer: undefined })
  })

  it("returns null for an unknown route", () => {
    expect(parseRouterReply("<route>delete_everything</route>")).toBeNull()
  })

  it("returns null when there is no <route> tag at all", () => {
    expect(parseRouterReply("I think this is an edit.")).toBeNull()
  })

  it("is case-insensitive on the route name", () => {
    expect(parseRouterReply("<route>EDIT</route>")).toEqual({ route: "edit", targets: [], answer: undefined })
  })
})

describe("routerPrompt", () => {
  it("lists every screen and the tab order", () => {
    const p = routerPrompt(manifest, "make the home tab title bigger")
    expect(p).toContain("home (tab): Home")
    expect(p).toContain(`habit-detail (stack, about "habits"): Habit Detail`)
    expect(p).toContain("Tabs: home, profile")
    expect(p).toContain("make the home tab title bigger")
  })
})
