import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getGithubAccess: vi.fn(),
  getExpoAccess: vi.fn(),
  claimWebDeployment: vi.fn(),
  getWebDeployment: vi.fn(),
  listWebDeployRuns: vi.fn(),
  runWebDeploy: vi.fn(),
  limit: vi.fn(),
}))

vi.mock("../../services/current-user", async (orig) => ({ ...(await orig<typeof import("../../services/current-user")>()), getCurrentUser: m.getCurrentUser }))
vi.mock("../../services/github/connect", async (orig) => ({ ...(await orig<typeof import("../../services/github/connect")>()), getAccess: m.getGithubAccess, markRevoked: vi.fn() }))
vi.mock("../../services/publish/expo-connect", async (orig) => ({ ...(await orig<typeof import("../../services/publish/expo-connect")>()), getAccess: m.getExpoAccess }))
vi.mock("../../services/publish/web-deploy", async (orig) => ({
  ...(await orig<typeof import("../../services/publish/web-deploy")>()),
  claimWebDeployment: m.claimWebDeployment,
  getWebDeployment: m.getWebDeployment,
  listWebDeployRuns: m.listWebDeployRuns,
}))
vi.mock("../../services/publish/run-web-deploy", () => ({ runWebDeploy: m.runWebDeploy }))
vi.mock("@/db", async (orig) => ({
  ...(await orig<typeof import("@/db")>()),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.limit }) }) }) },
}))

const { app } = await import("../../index")

const URL = "/api/projects/p1/publish/web"
const auth = { Authorization: "Bearer token" }
const project = { name: "Test App", previewScreens: {} }
const linked = { repoOwner: "o", repoName: "r" }

// The service reads the project first, then its GitHub link.
const withDb = (link: unknown[]) => m.limit.mockResolvedValueOnce([project]).mockResolvedValueOnce(link)
const post = () => request(app).post(URL).set(auth).set("content-type", "application/json").send({})

beforeEach(() => {
  vi.clearAllMocks()
  m.limit.mockReset()
  m.getCurrentUser.mockResolvedValue({ id: "u1" })
})

describe("GET /api/projects/:id/publish/web", () => {
  it("returns the current deployment status", async () => {
    m.getWebDeployment.mockResolvedValue({ projectId: "p1", status: "ready", url: "https://my-app.expo.app" })
    m.listWebDeployRuns.mockResolvedValue([])
    const res = await request(app).get(URL).set(auth)
    expect(res.status).toBe(200)
    expect(res.body.deployment).toMatchObject({ status: "ready", url: "https://my-app.expo.app" })
  })
})

describe("POST /api/projects/:id/publish/web", () => {
  it("409s when the project is not linked to GitHub", async () => {
    withDb([])
    const res = await post()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("not_linked")
  })

  it("409s when the GitHub account is not connected", async () => {
    withDb([linked])
    m.getGithubAccess.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("github_not_connected")
  })

  it("409s when the GitHub workflow scope is missing", async () => {
    withDb([linked])
    m.getGithubAccess.mockResolvedValue({ token: "gh_tok", scope: "repo,read:user" })
    const res = await post()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("github_workflow_scope_missing")
  })

  it("409s when the Expo account is not connected", async () => {
    withDb([linked])
    m.getGithubAccess.mockResolvedValue({ token: "gh_tok", scope: "repo,workflow" })
    m.getExpoAccess.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("expo_not_connected")
  })

  it("409s when a web deployment is already in progress", async () => {
    withDb([linked])
    m.getGithubAccess.mockResolvedValue({ token: "gh_tok", scope: "repo,workflow" })
    m.getExpoAccess.mockResolvedValue({ token: "expo_tok" })
    m.claimWebDeployment.mockResolvedValue({ ok: false, error: "deploy_in_progress" })
    const res = await post()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("deploy_in_progress")
  })

  it("claims the deployment and runs it on success", async () => {
    withDb([linked])
    m.getGithubAccess.mockResolvedValue({ token: "gh_tok", scope: "repo,workflow" })
    m.getExpoAccess.mockResolvedValue({ token: "expo_tok" })
    m.claimWebDeployment.mockResolvedValue({ ok: true, deployment: { projectId: "p1", status: "queued" }, runId: "run-1" })
    m.runWebDeploy.mockResolvedValue(undefined)
    const res = await post()
    expect(res.status).toBe(200)
    expect(m.runWebDeploy).toHaveBeenCalledWith({
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
