import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockRequireOwnedProject,
  mockGetGithubAccess,
  mockGetExpoAccess,
  mockClaimWebDeployment,
  mockGetWebDeployment,
  mockListWebDeployRuns,
  mockRunWebDeploy,
  mockDbSelect,
} = vi.hoisted(() => {
  const mockRequireOwnedProject = vi.fn()
  const mockGetGithubAccess = vi.fn()
  const mockGetExpoAccess = vi.fn()
  const mockClaimWebDeployment = vi.fn()
  const mockGetWebDeployment = vi.fn()
  const mockListWebDeployRuns = vi.fn()
  const mockRunWebDeploy = vi.fn()
  const mockDbSelect = vi.fn()

  return {
    mockRequireOwnedProject,
    mockGetGithubAccess,
    mockGetExpoAccess,
    mockClaimWebDeployment,
    mockGetWebDeployment,
    mockListWebDeployRuns,
    mockRunWebDeploy,
    mockDbSelect,
  }
})

vi.mock("@/lib/cloudhike/owner", () => ({
  requireOwnedProject: mockRequireOwnedProject,
}))

vi.mock("@/lib/github/connect", () => ({
  getAccess: mockGetGithubAccess,
  markRevoked: vi.fn(),
}))

vi.mock("@/lib/publish/expo-connect", () => ({
  getAccess: mockGetExpoAccess,
}))

vi.mock("@/lib/publish/web-deploy", () => ({
  claimWebDeployment: mockClaimWebDeployment,
  getWebDeployment: mockGetWebDeployment,
  listWebDeployRuns: mockListWebDeployRuns,
}))

vi.mock("@/lib/publish/run-web-deploy", () => ({
  runWebDeploy: mockRunWebDeploy,
}))

vi.mock("@/db", () => ({
  db: {
    select: mockDbSelect,
  },
  projectGithubLinks: {
    projectId: "projectId",
    userId: "userId",
  },
}))

const { GET, POST } = await import("../route")

describe("/api/projects/[projectId]/publish/web", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRequireOwnedProject.mockResolvedValue({
      project: { id: "p1", name: "Test App", previewScreens: {} },
      user: { id: "u1" },
    })
  })

  describe("GET", () => {
    it("returns current deployment status", async () => {
      mockGetWebDeployment.mockResolvedValue({
        projectId: "p1",
        status: "ready",
        url: "https://my-app.expo.app",
      })
      mockListWebDeployRuns.mockResolvedValue([])

      const req = new Request("http://localhost:3000/api/projects/p1/publish/web")
      const res = await GET(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.deployment.status).toBe("ready")
      expect(data.deployment.url).toBe("https://my-app.expo.app")
    })
  })

  describe("POST", () => {
    function createRequest() {
      return new Request("http://localhost:3000/api/projects/p1/publish/web", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
      })
    }

    it("returns 409 if project is not linked to GitHub", async () => {
      const mockLimit = vi.fn().mockResolvedValue([])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDbSelect.mockReturnValue({ from: mockFrom })

      const req = createRequest()
      const res = await POST(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toBe("not_linked")
    })

    it("returns 409 if GitHub account is not connected", async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ repoOwner: "o", repoName: "r" }])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDbSelect.mockReturnValue({ from: mockFrom })

      mockGetGithubAccess.mockResolvedValue(null)

      const req = createRequest()
      const res = await POST(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toBe("github_not_connected")
    })

    it("returns 409 if GitHub workflow scope is missing", async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ repoOwner: "o", repoName: "r" }])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDbSelect.mockReturnValue({ from: mockFrom })

      mockGetGithubAccess.mockResolvedValue({
        token: "gh_tok",
        scope: "repo,read:user",
      })

      const req = createRequest()
      const res = await POST(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toBe("github_workflow_scope_missing")
    })

    it("returns 409 if Expo account is not connected", async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ repoOwner: "o", repoName: "r" }])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDbSelect.mockReturnValue({ from: mockFrom })

      mockGetGithubAccess.mockResolvedValue({
        token: "gh_tok",
        scope: "repo,workflow",
      })
      mockGetExpoAccess.mockResolvedValue(null)

      const req = createRequest()
      const res = await POST(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toBe("expo_not_connected")
    })

    it("returns 409 if a web deployment is already in progress", async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ repoOwner: "o", repoName: "r" }])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDbSelect.mockReturnValue({ from: mockFrom })

      mockGetGithubAccess.mockResolvedValue({
        token: "gh_tok",
        scope: "repo,workflow",
      })
      mockGetExpoAccess.mockResolvedValue({ token: "expo_tok" })
      mockClaimWebDeployment.mockResolvedValue({ ok: false, error: "deploy_in_progress" })

      const req = createRequest()
      const res = await POST(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toBe("deploy_in_progress")
    })

    it("claims deployment and triggers runWebDeploy on success", async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ repoOwner: "o", repoName: "r" }])
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDbSelect.mockReturnValue({ from: mockFrom })

      mockGetGithubAccess.mockResolvedValue({
        token: "gh_tok",
        scope: "repo,workflow",
      })
      mockGetExpoAccess.mockResolvedValue({ token: "expo_tok" })
      mockClaimWebDeployment.mockResolvedValue({
        ok: true,
        deployment: { projectId: "p1", status: "queued" },
        runId: "run-1",
      })
      mockRunWebDeploy.mockResolvedValue(undefined)

      const req = createRequest()
      const res = await POST(req, { params: Promise.resolve({ projectId: "p1" }) })

      expect(res.status).toBe(200)
      expect(mockRunWebDeploy).toHaveBeenCalledWith({
        projectId: "p1",
        runId: "run-1",
        userId: "u1",
        projectName: "Test App",
        previewScreens: {},
        expoToken: "expo_tok",
        githubToken: "gh_tok",
        repoOwner: "o",
        repoName: "r",
      })
    })
  })
})
