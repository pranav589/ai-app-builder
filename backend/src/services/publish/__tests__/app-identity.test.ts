import { beforeEach, describe, expect, it, vi } from "vitest"

let selectResult: any[] = []

const { mockSelect, mockFrom, mockWhere, mockLimit, mockInsert, mockValues, mockOnConflictDoUpdate, mockReturning } = vi.hoisted(() => {
  const mockLimit = vi.fn(() => Promise.resolve(selectResult))
  const mockWhere = vi.fn(() => ({ limit: mockLimit }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))

  const mockReturning = vi.fn(() => Promise.resolve([{ projectId: "proj_test_123", androidPackage: "com.test.app", iosBundleId: "com.test.app" }]))
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }))
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }))
  const mockInsert = vi.fn(() => ({ values: mockValues }))

  return {
    mockSelect,
    mockFrom,
    mockWhere,
    mockLimit,
    mockInsert,
    mockValues,
    mockOnConflictDoUpdate,
    mockReturning,
  }
})

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
  projectAppIdentities: {
    projectId: "project_id",
  },
}))

const { ensureAppIdentity } = await import("../app-identity")

describe("app-identity", () => {
  beforeEach(() => {
    mockSelect.mockClear()
    mockInsert.mockClear()
  })

  it("reads package and bundleIdentifier from existing app.json on first use when no record exists", async () => {
    selectResult = []

    const appJson = JSON.stringify({
      expo: {
        android: { package: "com.test.app" },
        ios: { bundleIdentifier: "com.test.app" },
      },
    })

    const identity = await ensureAppIdentity("proj_test_123", appJson)
    expect(identity.projectId).toBe("proj_test_123")
    expect(identity.androidPackage).toBe("com.test.app")
    expect(identity.iosBundleId).toBe("com.test.app")
    expect(mockInsert).toHaveBeenCalled()
  })
})
