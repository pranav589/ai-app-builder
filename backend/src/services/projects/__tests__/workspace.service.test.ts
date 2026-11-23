import { beforeEach, describe, expect, it, vi } from "vitest"

// getWorkspaceData reads the project + its messages (both end in a plain
// array result), then independently calls getBackend/providerStatuses and
// (through withBackend) getBackend again + ensureAppKey/lanIPv4Stable -- so
// the project row and the messages list are the only two "db.select" chains
// to fake, keyed by call order.
const m = vi.hoisted(() => ({
  limit: vi.fn(),
  getBackend: vi.fn(),
  ensureAppKey: vi.fn(),
  providerStatuses: vi.fn(),
  backendInfo: vi.fn(),
  lanIPv4Stable: vi.fn(),
}))

vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.limit, orderBy: () => ({ limit: m.limit }) }) }) }) },
}))
vi.mock("../../storage", () => ({ signedDownloadUrl: async () => null }))
vi.mock("../../agent/orchestrator", () => ({ toStoredMessage: (row: unknown) => row }))
vi.mock("../../app-backend/app-backend", () => ({ getBackend: m.getBackend, ensureAppKey: m.ensureAppKey, backendInfo: m.backendInfo }))
vi.mock("../../app-backend/backend.service", () => ({ providerStatuses: m.providerStatuses }))
vi.mock("../../device/lan", () => ({ lanIPv4Stable: m.lanIPv4Stable }))
vi.mock("../../app-backend/registry", () => ({ providerFor: () => ({ id: "cloudhike" }) }))

const { getWorkspaceData } = await import("../workspace.service")

const project = {
  id: "p1",
  userId: "u1",
  name: "App",
  prompt: "",
  status: "ready",
  platform: "expo",
  createdAt: new Date("2026-01-01"),
  assets: [],
  isPublic: false,
  publicSlug: null,
  previewScreens: { v: 2, screens: [], backend: { provider: "local" }, files: { "package.json": JSON.stringify({ dependencies: {} }) } },
}

beforeEach(() => {
  m.limit.mockReset().mockResolvedValueOnce([project]).mockResolvedValueOnce([])
  m.getBackend.mockReset().mockResolvedValue(null)
  m.ensureAppKey.mockReset().mockResolvedValue("key-1")
  m.providerStatuses.mockReset().mockResolvedValue([])
  m.backendInfo.mockReset().mockReturnValue(null)
  m.lanIPv4Stable.mockReset().mockResolvedValue(null)
  process.env.NEXT_PUBLIC_APP_URL = "https://builder.example.com"
})

describe("getWorkspaceData", () => {
  it("keeps the on-device lib/backend when no backend is connected", async () => {
    const result = await getWorkspaceData("u1", "p1")
    expect(result!.project.files["lib/backend/index.ts"]).toBeUndefined()
  })

  it("shows the real connected backend's files -- not the stored local placeholder -- once one is connected", async () => {
    m.getBackend.mockResolvedValue({ projectId: "p1", provider: "cloudhike", status: "ready", envEnc: "enc", appKey: "key-1" })
    const result = await getWorkspaceData("u1", "p1")
    // The live code tab must show what the app is actually calling, the same
    // way an export does -- not the on-device Zustand placeholder that's all
    // that's ever persisted to the project doc.
    expect(result!.project.files["lib/backend/index.ts"]).toContain("@tanstack/react-query")
    const pkg = JSON.parse(result!.project.files["package.json"])
    expect(pkg.dependencies.axios).toBeTruthy()
  })
})
