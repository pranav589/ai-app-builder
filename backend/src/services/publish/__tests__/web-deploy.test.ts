import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  claimWebDeployment,
  getWebDeployment,
  markWebBuilding,
  markWebDeploying,
  markWebDispatched,
  markWebFailed,
  markWebReady,
} from "../web-deploy"

const { mockUpdate, mockInsert, mockSelect } = vi.hoisted(() => {
  const mockUpdate = vi.fn()
  const mockInsert = vi.fn()
  const mockSelect = vi.fn()
  return { mockUpdate, mockInsert, mockSelect }
})

vi.mock("@/db", () => ({
  db: {
    update: mockUpdate,
    insert: mockInsert,
    select: mockSelect,
  },
  webDeployments: {
    projectId: "projectId",
    userId: "userId",
    status: "status",
    url: "url",
    repoOwner: "repoOwner",
    repoName: "repoName",
    workflowRunId: "workflowRunId",
    workflowRunUrl: "workflowRunUrl",
    currentRunId: "currentRunId",
    error: "error",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    dispatchedAt: "dispatchedAt",
    lastDeployedAt: "lastDeployedAt",
  },
  webDeployRuns: {
    id: "id",
    projectId: "projectId",
    userId: "userId",
    status: "status",
    url: "url",
    repoOwner: "repoOwner",
    repoName: "repoName",
    workflowRunId: "workflowRunId",
    workflowRunUrl: "workflowRunUrl",
    error: "error",
    createdAt: "createdAt",
    dispatchedAt: "dispatchedAt",
    finishedAt: "finishedAt",
  },
}))

describe("web-deploy helper", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("claimWebDeployment", () => {
    it("successfully claims an existing non-in-flight deployment and logs a new run", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([{ projectId: "p1", status: "queued" }])
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning })
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere })
      mockUpdate.mockReturnValue({ set: mockUpdateSet })

      const mockInsertValues = vi.fn().mockResolvedValue(undefined)
      mockInsert.mockReturnValue({ values: mockInsertValues })

      const res = await claimWebDeployment({
        projectId: "p1",
        userId: "u1",
        repoOwner: "owner",
        repoName: "repo",
      })

      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.deployment.projectId).toBe("p1")
        expect(typeof res.runId).toBe("string")
      }
      // One insert for the webDeployRuns history row
      expect(mockInsert).toHaveBeenCalledTimes(1)
    })

    it("rejects when an in-flight deployment already exists", async () => {
      // Pointer update matches nothing because the WHERE clause only matches terminal statuses
      const mockUpdateReturning = vi.fn().mockResolvedValue([])
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning })
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere })
      mockUpdate.mockReturnValue({ set: mockUpdateSet })

      // Select finds the in-flight row
      const mockLimit = vi.fn().mockResolvedValue([{ projectId: "p1", status: "building" }])
      const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere })
      mockSelect.mockReturnValue({ from: mockFrom })

      const res = await claimWebDeployment({
        projectId: "p1",
        userId: "u1",
        repoOwner: "owner",
        repoName: "repo",
      })

      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error).toBe("deploy_in_progress")
      }
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it("inserts a new pointer row (plus a run row) if none exists yet", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([])
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning })
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere })
      mockUpdate.mockReturnValue({ set: mockUpdateSet })

      const mockLimit = vi.fn().mockResolvedValue([])
      const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere })
      mockSelect.mockReturnValue({ from: mockFrom })

      const mockInsertPointerReturning = vi.fn().mockResolvedValue([{ projectId: "p1", status: "queued" }])
      const mockInsertRunValues = vi.fn().mockResolvedValue(undefined)
      let callCount = 0
      mockInsert.mockImplementation(() => {
        callCount += 1
        if (callCount === 1) {
          return { values: vi.fn().mockReturnValue({ returning: mockInsertPointerReturning }) }
        }
        return { values: mockInsertRunValues }
      })

      const res = await claimWebDeployment({
        projectId: "p1",
        userId: "u1",
        repoOwner: "owner",
        repoName: "repo",
      })

      expect(res.ok).toBe(true)
      expect(mockInsert).toHaveBeenCalledTimes(2)
    })
  })

  describe("getWebDeployment", () => {
    it("returns null when deployment not found", async () => {
      const mockLimit = vi.fn().mockResolvedValue([])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockSelect.mockReturnValue({ from: mockFrom })

      const row = await getWebDeployment("p_missing")
      expect(row).toBeNull()
    })
  })

  describe("state transition helpers", () => {
    it("markWebDispatched flips queued -> dispatching on both the run row and the pointer", async () => {
      const mockSelectLimit = vi.fn().mockResolvedValue([{ id: "run1", status: "queued" }])
      const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit })
      const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere })
      mockSelect.mockReturnValue({ from: mockSelectFrom })

      const mockUpdateWhere = vi.fn().mockResolvedValue(undefined)
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere })
      mockUpdate.mockReturnValue({ set: mockUpdateSet })

      await markWebDispatched("p1", "run1", {})

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "dispatching" })
      )
    })

    it("markWebBuilding transitions dispatching -> building", async () => {
      const mockWhere = vi.fn().mockResolvedValue(undefined)
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      mockUpdate.mockReturnValue({ set: mockSet })

      await markWebBuilding("p1", "run1")

      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: "building" }))
    })

    it("markWebDeploying transitions to deploying", async () => {
      const mockWhere = vi.fn().mockResolvedValue(undefined)
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      mockUpdate.mockReturnValue({ set: mockSet })

      await markWebDeploying("p1", "run1")

      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: "deploying" }))
    })

    it("markWebReady updates status to ready with live url", async () => {
      const mockWhere = vi.fn().mockResolvedValue(undefined)
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      mockUpdate.mockReturnValue({ set: mockSet })

      await markWebReady("p1", "run1", { url: "https://my-app.expo.app", workflowRunUrl: "https://gh.run/1" })

      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ready",
          url: "https://my-app.expo.app",
          workflowRunUrl: "https://gh.run/1",
        })
      )
    })

    it("markWebFailed updates status to failed with error", async () => {
      const mockWhere = vi.fn().mockResolvedValue(undefined)
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
      mockUpdate.mockReturnValue({ set: mockSet })

      await markWebFailed("p1", "run1", "Deploy timeout", { workflowRunUrl: "https://gh.run/2" })

      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: "Deploy timeout",
          workflowRunUrl: "https://gh.run/2",
        })
      )
    })
  })
})
