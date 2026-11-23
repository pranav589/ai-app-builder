// @vitest-environment jsdom
//
// Regression test for a real on-device bug (Phase 10): the device backend's
// hooks (useCollection/useRecord/useSetting) have to work under the React
// Compiler, which the exported app.json enables by default. A hook that
// reads a mutated module-level variable by closure, instead of only the
// value useSyncExternalStore itself returns, can be served a stale,
// memoized render even after a real state change -- exactly what happened
// on a real phone and never showed up in the browser preview (which uses a
// different, already-correct shim). This mounts the actual generated
// backendDevice() source with a real React root in jsdom, so a regression
// here would be caught the same way it was actually found: by watching data
// fail to appear after it's loaded or changed.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { transform } from "sucrase"
import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { create as zustandCreate } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import { backendDevice, themeDevice } from "@/lib/app-project/templates"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type BackendModule = {
  db: { insert: (c: string, v: Record<string, unknown>) => Promise<{ id: string }> }
  useCollection: (c: string) => { data: { id: string; title: string }[]; loading: boolean; insert: (v: Record<string, unknown>) => Promise<unknown> }
}

function loadBackendModule(seed: { hash: string; collections: Record<string, unknown[]>; settings: Record<string, unknown>; user: { name: string; email: string } }): BackendModule {
  const source = backendDevice()
  const { code } = transform(source, { transforms: ["typescript", "imports"], production: true, filePath: "lib/backend/index.ts" })

  const storage = new Map<string, string>()
  const asyncStorage = {
    async getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null
    },
    async setItem(key: string, value: string) {
      storage.set(key, value)
    },
  }

  const fakeRequire = (spec: string) => {
    if (spec === "zustand") return { create: zustandCreate }
    if (spec === "zustand/middleware") return { persist, createJSONStorage }
    if (spec === "@react-native-async-storage/async-storage") return { default: asyncStorage, __esModule: true }
    if (spec === "@/data/seed.json") return { default: seed, __esModule: true }
    throw new Error(`unexpected require: ${spec}`)
  }

  const mod = { exports: {} as BackendModule }
  const fn = new Function("require", "module", "exports", code)
  fn(fakeRequire, mod, mod.exports)
  return mod.exports
}

const seed = {
  hash: "test-hash",
  collections: { tasks: [{ id: "t1", title: "Existing task", createdAt: "2026-01-01T00:00:00.000Z" }] },
  settings: {},
  user: { name: "Alex", email: "alex@example.com" },
}

describe("storage keys are namespaced per app", () => {
  // Expo Go hosts every scanned project under one install, reusing the same
  // exp:// URL as the device lane switches projects (lib/device/lane.ts), so
  // an unscoped AsyncStorage key would let one project's saved data leak into
  // the next project tested on the same phone -- which looks exactly like
  // "the old app is still open" even though the new bundle is the one running.
  it("backendDevice gives different apps different storage keys", () => {
    expect(backendDevice("pantry-pal")).toContain(`"app:pantry-pal:data"`)
    expect(backendDevice("habit-tracker")).toContain(`"app:habit-tracker:data"`)
    expect(backendDevice("pantry-pal")).not.toContain(`"app:habit-tracker:data"`)
  })

  it("themeDevice gives different apps different storage keys", () => {
    expect(themeDevice("pantry-pal")).toContain(`"app:pantry-pal:theme"`)
    expect(themeDevice("habit-tracker")).toContain(`"app:habit-tracker:theme"`)
  })
})

describe("backendDevice() hooks under a real React root", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("resolves loading and shows the seed data without any extra interaction", async () => {
    const backend = loadBackendModule(seed)

    function Probe() {
      const { data, loading } = backend.useCollection("tasks")
      return React.createElement("div", { "data-testid": "out" }, loading ? "loading" : `ready:${data.length}`)
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    // The initial AsyncStorage read is async; give it a chance to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(container.querySelector('[data-testid="out"]')?.textContent).toBe("ready:1")
  })

  it("reflects an insert without needing a manual reload", async () => {
    const backend = loadBackendModule(seed)

    function Probe() {
      const { data, loading, insert } = backend.useCollection("tasks")
      return React.createElement(
        "button",
        {
          "data-testid": "out",
          onClick: () => void insert({ title: "New task" }),
        },
        loading ? "loading" : `ready:${data.length}`
      )
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(container.querySelector('[data-testid="out"]')?.textContent).toBe("ready:1")

    await act(async () => {
      container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(container.querySelector('[data-testid="out"]')?.textContent).toBe("ready:2")
  })
})
