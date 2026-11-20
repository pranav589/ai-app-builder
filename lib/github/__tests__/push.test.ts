import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildTreeEntries,
  defaultCommitMessage,
  pushProject,
  type PushStep,
} from "../push"
import * as api from "../api"

class MockGithubApiError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message)
    this.name = "GithubApiError"
  }
}

vi.mock("../api", () => ({
  createRepo: vi.fn(),
  getRef: vi.fn(),
  createTree: vi.fn(),
  createCommit: vi.fn(),
  createRef: vi.fn(),
  updateRef: vi.fn(),
  initEmptyRepo: vi.fn(),
  GithubApiError: class MockGithubApiError extends Error {
    constructor(message: string, readonly status = 409) {
      super(message)
      this.name = "GithubApiError"
    }
  },
}))

describe("push helpers", () => {
  it("buildTreeEntries produces a blob entry for every file", () => {
    const files = {
      "app/index.tsx": "export default function Screen() {}",
      "package.json": '{"name": "app"}',
    }
    const entries = buildTreeEntries(files)
    expect(entries).toEqual([
      {
        path: "app/index.tsx",
        mode: "100644",
        type: "blob",
        content: "export default function Screen() {}",
      },
      {
        path: "package.json",
        mode: "100644",
        type: "blob",
        content: '{"name": "app"}',
      },
    ])
  })

  it("defaultCommitMessage formats correctly for first push and updates", () => {
    expect(defaultCommitMessage(1, "Store App", true)).toBe("Export Store App: 1 file")
    expect(defaultCommitMessage(12, "Store App", true)).toBe("Export Store App: 12 files")
    expect(defaultCommitMessage(1, "Store App", false)).toBe("Update Store App: 1 file")
    expect(defaultCommitMessage(5, "Store App", false)).toBe("Update Store App: 5 files")
  })
})

describe("pushProject orchestration", () => {
  const token = "gh_secret_token"
  const files = {
    "app/index.tsx": "export default function App() {}",
    "README.md": "# Readme",
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("scenario 1: pushes to a new empty repository (no parent commit, creates branch ref)", async () => {
    const steps: PushStep[] = []
    vi.mocked(api.createRepo).mockResolvedValueOnce({
      id: 123,
      name: "new-repo",
      full_name: "testuser/new-repo",
      owner: { login: "testuser" },
      private: true,
      html_url: "https://github.com/testuser/new-repo",
    })
    vi.mocked(api.getRef).mockResolvedValueOnce(null) // 404 for empty repo branch
    vi.mocked(api.createTree).mockResolvedValueOnce({ sha: "tree_sha_1" })
    vi.mocked(api.createCommit).mockResolvedValueOnce({
      sha: "commit_sha_1",
      html_url: "https://github.com/testuser/new-repo/commit/commit_sha_1",
      tree: { sha: "tree_sha_1" },
    })
    vi.mocked(api.createRef).mockResolvedValueOnce({
      ref: "refs/heads/main",
      object: { sha: "commit_sha_1", type: "commit" },
    })

    const result = await pushProject(token, {
      target: { kind: "create", name: "new-repo", private: true },
      branch: { mode: "existing" },
      message: "Export new-repo: 2 files",
      files,
      onProgress: (step) => steps.push(step),
    })

    expect(steps).toEqual([
      "resolving-repo",
      "reading-branch",
      "building-tree",
      "committing",
      "updating-branch",
    ])

    expect(api.createRepo).toHaveBeenCalledWith(token, { name: "new-repo", private: true })
    expect(api.getRef).toHaveBeenCalledWith(token, "testuser", "new-repo", "heads/main")
    expect(api.createTree).toHaveBeenCalledWith(token, "testuser", "new-repo", [
      { path: "app/index.tsx", mode: "100644", type: "blob", content: files["app/index.tsx"] },
      { path: "README.md", mode: "100644", type: "blob", content: files["README.md"] },
    ])
    // Verify base_tree was NEVER passed
    const createTreeCalls = vi.mocked(api.createTree).mock.calls
    expect(createTreeCalls[0].length).toBe(4) // token, owner, repo, tree (no 5th base_tree argument)
    expect((createTreeCalls[0][3] as unknown as { base_tree?: string }).base_tree).toBeUndefined()

    expect(api.createCommit).toHaveBeenCalledWith(token, "testuser", "new-repo", {
      message: "Export new-repo: 2 files",
      tree: "tree_sha_1",
      parents: [],
    })
    expect(api.createRef).toHaveBeenCalledWith(token, "testuser", "new-repo", "main", "commit_sha_1")
    expect(api.updateRef).not.toHaveBeenCalled()

    expect(result).toEqual({
      owner: "testuser",
      name: "new-repo",
      branch: "main",
      commitSha: "commit_sha_1",
      htmlUrl: "https://github.com/testuser/new-repo/commit/commit_sha_1",
    })
  })

  it("scenario 2: pushes to an existing branch fast-forward (has parent commit, updates branch ref)", async () => {
    const steps: PushStep[] = []
    vi.mocked(api.getRef).mockResolvedValueOnce({
      ref: "refs/heads/main",
      object: { sha: "parent_sha_10", type: "commit" },
    })
    vi.mocked(api.createTree).mockResolvedValueOnce({ sha: "tree_sha_2" })
    vi.mocked(api.createCommit).mockResolvedValueOnce({
      sha: "commit_sha_2",
      html_url: "https://github.com/org1/existing-repo/commit/commit_sha_2",
      tree: { sha: "tree_sha_2" },
    })
    vi.mocked(api.updateRef).mockResolvedValueOnce({
      ref: "refs/heads/main",
      object: { sha: "commit_sha_2", type: "commit" },
    })

    const result = await pushProject(token, {
      target: { kind: "existing", owner: "org1", name: "existing-repo" },
      branch: { mode: "existing" },
      message: "Update existing-repo: 2 files",
      files,
      linked: {
        repoOwner: "org1",
        repoName: "existing-repo",
        lastBranch: "main",
        lastCommitSha: "parent_sha_10",
      },
      onProgress: (step) => steps.push(step),
    })

    expect(steps).toEqual([
      "resolving-repo",
      "reading-branch",
      "building-tree",
      "committing",
      "updating-branch",
    ])

    expect(api.createRepo).not.toHaveBeenCalled()
    expect(api.getRef).toHaveBeenCalledWith(token, "org1", "existing-repo", "heads/main")
    expect(api.createCommit).toHaveBeenCalledWith(token, "org1", "existing-repo", {
      message: "Update existing-repo: 2 files",
      tree: "tree_sha_2",
      parents: ["parent_sha_10"],
    })
    expect(api.updateRef).toHaveBeenCalledWith(
      token,
      "org1",
      "existing-repo",
      "heads/main",
      "commit_sha_2",
      false
    )
    expect(api.createRef).not.toHaveBeenCalled()

    expect(result).toEqual({
      owner: "org1",
      name: "existing-repo",
      branch: "main",
      commitSha: "commit_sha_2",
      htmlUrl: "https://github.com/org1/existing-repo/commit/commit_sha_2",
    })
  })

  it("scenario 3: creates a new branch off current tip", async () => {
    const steps: PushStep[] = []
    vi.mocked(api.getRef).mockResolvedValueOnce({
      ref: "refs/heads/main",
      object: { sha: "tip_sha_99", type: "commit" },
    })
    vi.mocked(api.createTree).mockResolvedValueOnce({ sha: "tree_sha_3" })
    vi.mocked(api.createCommit).mockResolvedValueOnce({
      sha: "commit_sha_3",
      html_url: "https://github.com/user2/my-app/commit/commit_sha_3",
      tree: { sha: "tree_sha_3" },
    })
    vi.mocked(api.createRef).mockResolvedValueOnce({
      ref: "refs/heads/export-feature",
      object: { sha: "commit_sha_3", type: "commit" },
    })

    const result = await pushProject(token, {
      target: { kind: "existing", owner: "user2", name: "my-app" },
      branch: { mode: "new", name: "export-feature" },
      message: "Update my-app: 2 files",
      files,
      linked: {
        repoOwner: "user2",
        repoName: "my-app",
        lastBranch: "main",
        lastCommitSha: "tip_sha_99",
      },
      onProgress: (step) => steps.push(step),
    })

    expect(steps).toEqual([
      "resolving-repo",
      "reading-branch",
      "building-tree",
      "committing",
      "updating-branch",
    ])

    expect(api.getRef).toHaveBeenCalledWith(token, "user2", "my-app", "heads/main")
    expect(api.createCommit).toHaveBeenCalledWith(token, "user2", "my-app", {
      message: "Update my-app: 2 files",
      tree: "tree_sha_3",
      parents: ["tip_sha_99"],
    })
    expect(api.createRef).toHaveBeenCalledWith(
      token,
      "user2",
      "my-app",
      "export-feature",
      "commit_sha_3"
    )
    expect(api.updateRef).not.toHaveBeenCalled()

    expect(result).toEqual({
      owner: "user2",
      name: "my-app",
      branch: "export-feature",
      commitSha: "commit_sha_3",
      htmlUrl: "https://github.com/user2/my-app/commit/commit_sha_3",
    })
  })

  it("scenario 4: initializes and recovers when pushing to an empty repo where createTree returns 'Git Repository is empty.'", async () => {
    vi.mocked(api.getRef).mockResolvedValueOnce(null)
    // First createTree fails with 409 Git Repository is empty
    vi.mocked(api.createTree)
      .mockRejectedValueOnce(new api.GithubApiError("Git Repository is empty.", 409))
      .mockResolvedValueOnce({ sha: "tree_sha_empty_recovered" })

    vi.mocked(api.initEmptyRepo).mockResolvedValueOnce({ commitSha: "init_commit_sha" })
    vi.mocked(api.createCommit).mockResolvedValueOnce({
      sha: "commit_sha_4",
      html_url: "https://github.com/user3/empty-repo/commit/commit_sha_4",
      tree: { sha: "tree_sha_empty_recovered" },
    })
    vi.mocked(api.updateRef).mockResolvedValueOnce({
      ref: "refs/heads/main",
      object: { sha: "commit_sha_4", type: "commit" },
    })

    const result = await pushProject(token, {
      target: { kind: "existing", owner: "user3", name: "empty-repo" },
      branch: { mode: "existing" },
      message: "Export empty-repo: 2 files",
      files,
    })

    expect(api.initEmptyRepo).toHaveBeenCalledWith(token, "user3", "empty-repo", "main")
    expect(api.createTree).toHaveBeenCalledTimes(2)
    expect(api.createCommit).toHaveBeenCalledWith(token, "user3", "empty-repo", {
      message: "Export empty-repo: 2 files",
      tree: "tree_sha_empty_recovered",
      parents: ["init_commit_sha"],
    })
    expect(api.updateRef).toHaveBeenCalledWith(
      token,
      "user3",
      "empty-repo",
      "heads/main",
      "commit_sha_4",
      false
    )
    expect(result.commitSha).toBe("commit_sha_4")
  })
})
