import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dispatchProjectWorkflow } from "../dispatch"

const {
  mockGetRepo,
  mockPushProject,
  mockUpsertRepoSecret,
  mockDispatchWorkflow,
  mockListWorkflowRuns,
  mockDbInsert,
} = vi.hoisted(() => {
  const mockGetRepo = vi.fn()
  const mockPushProject = vi.fn()
  const mockUpsertRepoSecret = vi.fn()
  const mockDispatchWorkflow = vi.fn()
  const mockListWorkflowRuns = vi.fn()

  const mockConflictUpdate = vi.fn().mockResolvedValue(undefined)
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockConflictUpdate })
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockValues })

  return {
    mockGetRepo,
    mockPushProject,
    mockUpsertRepoSecret,
    mockDispatchWorkflow,
    mockListWorkflowRuns,
    mockDbInsert,
  }
})

vi.mock("@/lib/github/api", () => ({
  getRepo: mockGetRepo,
  dispatchWorkflow: mockDispatchWorkflow,
  listWorkflowRuns: mockListWorkflowRuns,
}))

vi.mock("@/lib/github/push", () => ({
  pushProject: mockPushProject,
}))

vi.mock("../github-secrets", () => ({
  upsertRepoSecret: mockUpsertRepoSecret,
}))

vi.mock("@/db", () => ({
  db: {
    insert: mockDbInsert,
  },
  projectGithubLinks: {
    projectId: "projectId",
  },
}))

describe("dispatchProjectWorkflow", () => {
  const originalEnv = process.env.PUBLISH_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = "test_webhook_secret"
    vi.clearAllMocks()

    mockGetRepo.mockResolvedValue({ default_branch: "master" })
    mockPushProject.mockResolvedValue({
      owner: "testowner",
      name: "testrepo",
      branch: "master",
      commitSha: "sha123",
    })
    mockUpsertRepoSecret.mockResolvedValue(undefined)
    mockDispatchWorkflow.mockResolvedValue(undefined)
    mockListWorkflowRuns.mockResolvedValue({ workflow_runs: [] })
  })

  afterEach(() => {
    process.env.PUBLISH_WEBHOOK_SECRET = originalEnv
  })

  it("pushes project, updates secrets, dispatches workflow, and invokes onDispatched", async () => {
    const onDispatched = vi.fn().mockResolvedValue(undefined)
    const onFailed = vi.fn().mockResolvedValue(undefined)

    const res = await dispatchProjectWorkflow({
      githubToken: "gh_tok",
      expoToken: "expo_tok",
      repoOwner: "testowner",
      repoName: "testrepo",
      linked: {
        projectId: "p1",
        userId: "u1",
        repoOwner: "testowner",
        repoName: "testrepo",
        lastBranch: "master",
        lastCommitSha: null,
        updatedAt: new Date(),
      },
      exportFiles: { "app.json": "{}" },
      commitMessage: "Test commit",
      workflowFileName: "eas-web-deploy.yml",
      workflowInputs: { project_id: "p1" },
      onDispatched,
      onFailed,
    })

    expect(mockPushProject).toHaveBeenCalled()
    expect(mockUpsertRepoSecret).toHaveBeenCalledWith("gh_tok", "testowner", "testrepo", "EXPO_TOKEN", "expo_tok")
    expect(mockUpsertRepoSecret).toHaveBeenCalledWith(
      "gh_tok",
      "testowner",
      "testrepo",
      "PUBLISH_WEBHOOK_SECRET",
      "test_webhook_secret"
    )
    expect(mockDispatchWorkflow).toHaveBeenCalledWith(
      "gh_tok",
      "testowner",
      "testrepo",
      "eas-web-deploy.yml",
      "master",
      { project_id: "p1" }
    )
    expect(onDispatched).toHaveBeenCalledWith({})
    expect(res.pushResult.commitSha).toBe("sha123")
  })

  it("calls onFailed and rethrows if push fails", async () => {
    mockPushProject.mockRejectedValue(new Error("Push rejected"))
    const onDispatched = vi.fn().mockResolvedValue(undefined)
    const onFailed = vi.fn().mockResolvedValue(undefined)

    await expect(
      dispatchProjectWorkflow({
        githubToken: "gh_tok",
        expoToken: "expo_tok",
        repoOwner: "testowner",
        repoName: "testrepo",
        linked: undefined,
        exportFiles: {},
        commitMessage: "Test commit",
        workflowFileName: "eas-web-deploy.yml",
        workflowInputs: {},
        onDispatched,
        onFailed,
      })
    ).rejects.toThrow("Push rejected")

    expect(onFailed).toHaveBeenCalledWith("Push rejected")
    expect(onDispatched).not.toHaveBeenCalled()
  })
})
