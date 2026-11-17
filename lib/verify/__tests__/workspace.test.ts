import { describe, expect, it } from "vitest"
import { applyChangeSet, docFromWorkspace, workspaceFromDoc } from "@/lib/verify/workspace"
import type { ChangeSet, Workspace } from "@/lib/verify/types"
import type { AppDoc } from "@/lib/app-runtime/app-doc"
import type { AppManifest } from "@/lib/manifest/schema"

const cs = (overrides: Partial<ChangeSet>): ChangeSet => ({ intent: "test", manifestPatch: [], files: [], ...overrides })

describe("applyChangeSet", () => {
  const base = { files: { "app/home.tsx": "export default function Home() {\n  return null\n}\n" } }

  it("writes a new file", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "components/Card.tsx", op: "write", content: "export const Card = () => null\n" }] }))
    expect(r.diagnostics).toEqual([])
    expect(r.ws?.files["components/Card.tsx"]).toBe("export const Card = () => null\n")
    expect(r.changed).toEqual(["components/Card.tsx"])
  })

  it("applies a matching edit hunk", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/home.tsx", op: "edit", hunks: [{ search: "return null", replace: "return <View />" }] }] }))
    expect(r.diagnostics).toEqual([])
    expect(r.ws?.files["app/home.tsx"]).toContain("return <View />")
  })

  it("deletes a file", () => {
    const withExtra = { files: { ...base.files, "components/Old.tsx": "export const Old = () => null\n" } }
    const r = applyChangeSet(withExtra, cs({ files: [{ path: "components/Old.tsx", op: "delete" }] }))
    expect(r.diagnostics).toEqual([])
    expect(r.ws?.files["components/Old.tsx"]).toBeUndefined()
  })

  it("reports a non-matching hunk without applying it", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/home.tsx", op: "edit", hunks: [{ search: "this text is not in the file", replace: "x" }] }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ gate: "parse", code: "edit_no_match" })
  })

  it("refuses to edit a platform-owned path", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "theme/index.tsx", op: "write", content: "x" }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ gate: "policy", code: "platform_owned" })
  })

  it("refuses to edit a compiler-owned path", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/_layout.tsx", op: "write", content: "x" }] }))
    expect(r.diagnostics[0]).toMatchObject({ gate: "policy", code: "compiler_owned" })
  })

  it("refuses a path outside the writable areas", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "scripts/evil.mjs", op: "write", content: "x" }] }))
    expect(r.diagnostics[0]).toMatchObject({ gate: "policy", code: "path_not_allowed" })
  })

  it("rejects a path with a directory traversal", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/../../../etc/passwd", op: "write", content: "x" }] }))
    expect(r.diagnostics[0].code).toBe("path_not_allowed")
  })

  it("reports editing a file that doesn't exist yet", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/missing.tsx", op: "edit", hunks: [{ search: "x", replace: "y" }] }] }))
    expect(r.diagnostics[0]).toMatchObject({ gate: "parse", code: "edit_missing_file" })
  })
})

describe("workspaceFromDoc / docFromWorkspace", () => {
  const doc: AppDoc = {
    v: 2,
    backend: { provider: "local" },
    screens: [{ id: "home", name: "Home", state: "ready", path: "app/home.tsx", code: "old code\n" }],
    files: { "components/Card.tsx": "export const Card = () => null\n" },
  }

  it("puts screen code and other files into one FileMap", () => {
    const ws = workspaceFromDoc(doc)
    expect(ws.files["app/home.tsx"]).toBe("old code\n")
    expect(ws.files["components/Card.tsx"]).toBe("export const Card = () => null\n")
  })

  it("writes changed screen code back by path and marks it ready", () => {
    const ws = workspaceFromDoc(doc)
    const next = docFromWorkspace(doc, { files: { ...ws.files, "app/home.tsx": "new code\n" } })
    expect(next.screens[0].code).toBe("new code\n")
    expect(next.screens[0].state).toBe("ready")
  })

  it("writes non-screen files back into doc.files", () => {
    const ws = workspaceFromDoc(doc)
    const next = docFromWorkspace(doc, { files: { ...ws.files, "components/Card.tsx": "export const Card = () => <View />\n" } })
    expect(next.files?.["components/Card.tsx"]).toBe("export const Card = () => <View />\n")
  })
})

const manifest: AppManifest = {
  schemaVersion: 1,
  app: { name: "Habit Tracker", slug: "habit-tracker" },
  screens: {
    home: { title: "Home", presentation: "tab", icon: "home-outline" },
    profile: { title: "Profile", presentation: "tab", icon: "person-outline" },
  },
  navigation: { tabs: ["home", "profile"], initial: "home" },
  collections: {},
  allowedPackages: ["react", "react-native"],
}

describe("applyChangeSet with a manifest patch", () => {
  const base: Workspace = { manifest, files: { "app/(tabs)/home.tsx": "x", "app/(tabs)/profile.tsx": "x" } }

  it("adds a screen whose file is written in the same change", () => {
    const r = applyChangeSet(
      base,
      cs({
        manifestPatch: [{ op: "add", path: "/screens/settings", value: { title: "Settings", presentation: "stack" } }],
        files: [{ path: "app/settings.tsx", op: "write", content: `export default function Settings() { return null }\n` }],
      })
    )
    expect(r.diagnostics).toEqual([])
    expect((r.ws?.manifest as AppManifest).screens.settings).toBeTruthy()
    expect(r.ws?.files["app/settings.tsx"]).toContain("Settings")
    expect(r.changed).toContain("app/settings.tsx")
    expect(r.changed).toContain("lib/nav.ts")
  })

  it("rejects a manifest patch that adds a screen without its file", () => {
    const r = applyChangeSet(base, cs({ manifestPatch: [{ op: "add", path: "/screens/settings", value: { title: "Settings", presentation: "stack" } }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics.some((d) => d.gate === "manifest" && d.code === "screen_missing_file")).toBe(true)
  })

  it("rejects a manifest patch when there is no manifest yet", () => {
    const r = applyChangeSet({ files: {} }, cs({ manifestPatch: [{ op: "add", path: "/screens/settings", value: { title: "Settings", presentation: "stack" } }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ gate: "manifest", code: "no_manifest" })
  })

  it("rejects a manifest patch that fails validation", () => {
    const r = applyChangeSet(base, cs({ manifestPatch: [{ op: "remove", path: "/navigation/tabs/1" }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics.some((d) => d.gate === "manifest")).toBe(true)
  })

  it("rejects a malformed patch path", () => {
    const r = applyChangeSet(base, cs({ manifestPatch: [{ op: "replace", path: "/screens/nope/title", value: "x" }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ gate: "manifest", code: "patch_failed" })
  })

  it("recompiles app/_layout.tsx, app/(tabs)/_layout.tsx, app/index.tsx, lib/nav.ts and data/types.ts when the manifest changes", () => {
    const r = applyChangeSet(
      base,
      cs({
        manifestPatch: [{ op: "add", path: "/screens/settings", value: { title: "Settings", presentation: "stack" } }],
        files: [{ path: "app/settings.tsx", op: "write", content: `export default function Settings() { return null }\n` }],
      })
    )
    for (const p of ["app/_layout.tsx", "app/(tabs)/_layout.tsx", "app/index.tsx", "lib/nav.ts", "data/types.ts"]) expect(r.ws?.files[p]).toBeTruthy()
  })
})

describe("docFromWorkspace with a manifest", () => {
  const doc: AppDoc = { v: 2, backend: { provider: "local" }, screens: [{ id: "home", name: "Home", state: "ready", path: "app/home.tsx", code: "old" }], manifest }

  it("adds a new GeneratedScreen for a manifest screen that gained a file", () => {
    const withNewScreen: AppManifest = { ...manifest, screens: { ...manifest.screens, settings: { title: "Settings", presentation: "stack" } } }
    const next = docFromWorkspace(doc, { manifest: withNewScreen, files: { "app/home.tsx": "old", "app/profile.tsx": "x", "app/settings.tsx": "new screen code" } })
    const settings = next.screens.find((s) => s.id === "settings")
    expect(settings).toMatchObject({ name: "Settings", path: "app/settings.tsx", code: "new screen code", state: "ready" })
  })

  it("drops a GeneratedScreen the manifest patch removed", () => {
    const withoutHome: AppManifest = { ...manifest, screens: { profile: manifest.screens.profile }, navigation: { tabs: ["profile"], initial: "profile" } }
    const next = docFromWorkspace(doc, { manifest: withoutHome, files: { "app/profile.tsx": "x" } })
    expect(next.screens.find((s) => s.id === "home")).toBeUndefined()
  })
})
