import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  loadProject: vi.fn(),
  getBackend: vi.fn(),
  ensureAppKey: vi.fn(),
  builderUrl: vi.fn(),
  runChange: vi.fn(),
  commitSnapshot: vi.fn(),
}))

vi.mock("../history", () => ({ loadProject: m.loadProject }))
vi.mock("../../app-backend/app-backend", () => ({ getBackend: m.getBackend, ensureAppKey: m.ensureAppKey }))
vi.mock("../../app-project/with-backend", () => ({ builderUrl: m.builderUrl }))
vi.mock("../../verify/run", () => ({ runChange: m.runChange }))
vi.mock("../../versions/store", () => ({ commitSnapshot: m.commitSnapshot }))

const { convertBackend, pickTargets } = await import("../backend-conversion")

const manifest = { schemaVersion: 1, app: { name: "App", slug: "app" }, screens: {}, navigation: { tabs: [], initial: "home" }, collections: {}, allowedPackages: [] }

beforeEach(() => {
  m.loadProject.mockReset().mockResolvedValue({ id: "p1", previewScreens: null })
  m.getBackend.mockReset().mockResolvedValue({ projectId: "p1", provider: "cloudhike", status: "ready", appKey: null })
  m.ensureAppKey.mockReset().mockResolvedValue("key-1")
  m.builderUrl.mockReset().mockResolvedValue("https://builder.example")
  m.runChange.mockReset()
  m.commitSnapshot.mockReset().mockResolvedValue({ version: 2 })
})

describe("pickTargets", () => {
  it("connect: picks every stores/** file, plus app files importing a store or the seed data", () => {
    const files = {
      "stores/useTasksStore.ts": "export const useTasksStore = () => {}",
      "app/home.tsx": `import { useTasksStore } from "@/stores/useTasksStore"\nexport default function Home() { return null }`,
      "app/seeded.tsx": `import seed from "@/data/seed.json"\nexport default function X() { return null }`,
      "app/unrelated.tsx": `export default function Y() { return null }`,
      "lib/api.ts": "export const api = {}",
    }
    expect(pickTargets(files, "connect").sort()).toEqual(["app/home.tsx", "app/seeded.tsx", "stores/useTasksStore.ts"])
  })

  it("disconnect: picks every app file importing @/lib/api, not stores", () => {
    const files = {
      "app/home.tsx": `import { api } from "@/lib/api"\nexport default function Home() { return null }`,
      "app/unrelated.tsx": `export default function Y() { return null }`,
    }
    expect(pickTargets(files, "disconnect")).toEqual(["app/home.tsx"])
  })

  it("ignores platform-owned files even if they happen to mention a store import", () => {
    const files = { "theme/index.tsx": `// @/stores/useTasksStore\nexport {}` }
    expect(pickTargets(files, "connect")).toEqual([])
  })
})

describe("convertBackend", () => {
  const baseDoc = {
    v: 2 as const,
    screens: [{ id: "home", name: "Home", state: "ready" as const, path: "app/home.tsx", code: `import { useTasksStore } from "@/stores/useTasksStore"\nexport default function Home() { return null }` }],
    files: { "stores/useTasksStore.ts": "export const useTasksStore = () => {}" },
    manifest,
    backend: { provider: "cloudhike" as const, projectRef: "ref1" },
  }

  it("connect: adds lib/api.ts/.config.ts, runs the conversion, and commits one version", async () => {
    m.loadProject.mockResolvedValue({ id: "p1", previewScreens: baseDoc })
    // Mirrors what applyChangeSet actually returns: base.files plus the model's
    // edits, i.e. the lib/api.ts/.config.ts this function already injected
    // stay present (the model never touches them) and only the screen changed.
    m.runChange.mockImplementation(async (ws: { files: Record<string, string> }) => ({
      state: "committed",
      ws: { files: { ...ws.files, "app/home.tsx": "export default function Home() { return null }" } },
      changed: ["app/home.tsx"],
      intent: "x",
      attempts: [],
    }))

    const result = await convertBackend(null, "p1", "connect")
    expect(result.converted).toBe(true)
    expect(m.ensureAppKey).toHaveBeenCalled()
    // The connected root layout must already be in place when runChange verifies the
    // conversion (a converted screen's useQuery/useMutation needs QueryClientProvider in
    // context during that very check), not added only afterward.
    const wsPassedToRunChange = m.runChange.mock.calls[0][0]
    expect(wsPassedToRunChange.files["app/_layout.tsx"]).toContain("QueryClientProvider")
    expect(m.commitSnapshot).toHaveBeenCalledTimes(1)
    const [projectId, committedDoc] = m.commitSnapshot.mock.calls[0]
    expect(projectId).toBe("p1")
    expect(committedDoc.files["lib/api.ts"]).toBeDefined()
    expect(committedDoc.files["lib/api-config.ts"]).toBeDefined()
    expect(committedDoc.files["app/_layout.tsx"]).toContain("QueryClientProvider")
  })

  it("connect: a verification failure still commits (lib/api.ts added, root layout wrapped) with a soft-failure message, not a throw", async () => {
    m.loadProject.mockResolvedValue({ id: "p1", previewScreens: baseDoc })
    m.runChange.mockResolvedValue({ state: "needs_user", reason: "exhausted", message: "still failing", attempts: [] })

    const result = await convertBackend(null, "p1", "connect")
    expect(result.converted).toBe(true)
    expect(result.message).toContain("still failing")
    expect(m.commitSnapshot).toHaveBeenCalledTimes(1)
  })

  it("disconnect: removes lib/api.ts/.config.ts and un-wraps the root layout", async () => {
    const connectedDoc = {
      ...baseDoc,
      backend: { provider: "local" as const },
      screens: [{ id: "home", name: "Home", state: "ready" as const, path: "app/home.tsx", code: `import { api } from "@/lib/api"\nexport default function Home() { return null }` }],
      files: { ...baseDoc.files, "lib/api.ts": "export const api = {}", "lib/api-config.ts": "export const API_URL = \"\"" },
    }
    m.loadProject.mockResolvedValue({ id: "p1", previewScreens: connectedDoc })
    m.runChange.mockImplementation(async (ws: { files: Record<string, string> }) => ({
      state: "committed",
      ws: { files: { ...ws.files, "app/home.tsx": "export default function Home() { return null }" } },
      changed: ["app/home.tsx"],
      intent: "x",
      attempts: [],
    }))

    const result = await convertBackend(null, "p1", "disconnect")
    expect(result.converted).toBe(true)
    const committedDoc = m.commitSnapshot.mock.calls[0][1]
    expect(committedDoc.files["lib/api.ts"]).toBeUndefined()
    expect(committedDoc.files["lib/api-config.ts"]).toBeUndefined()
    expect(committedDoc.files["app/_layout.tsx"]).not.toContain("QueryClientProvider")
  })

  it("does nothing but still return gracefully when there's no manifest yet", async () => {
    m.loadProject.mockResolvedValue({ id: "p1", previewScreens: { v: 2, screens: [], backend: { provider: "local" } } })
    const result = await convertBackend(null, "p1", "connect")
    expect(result.converted).toBe(false)
    expect(m.commitSnapshot).not.toHaveBeenCalled()
  })
})
