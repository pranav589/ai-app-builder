import type { FileMap } from "@app/shared/verify/types"
import {
  createCommit,
  createRef,
  createRepo,
  createTree,
  getRef,
  GithubApiError,
  initEmptyRepo,
  updateRef,
  type TreeEntry,
} from "./api"

export type PushStep = "resolving-repo" | "reading-branch" | "building-tree" | "committing" | "updating-branch"

export type PushTarget =
  | { kind: "create"; name: string; private: boolean }
  | { kind: "existing"; owner: string; name: string }

export type PushBranch =
  | { mode: "existing" }
  | { mode: "new"; name: string }

export type PushOptions = {
  target: PushTarget
  branch: PushBranch
  message: string
  files: FileMap
  linked?: { repoOwner: string; repoName: string; lastBranch: string; lastCommitSha?: string | null } | null
  onProgress?: (step: PushStep) => void
}

export type PushResult = {
  owner: string
  name: string
  branch: string
  commitSha: string
  htmlUrl: string
}

export function buildTreeEntries(files: FileMap): TreeEntry[] {
  return Object.entries(files).map(([path, content]) => ({
    path,
    mode: "100644",
    type: "blob",
    content,
  }))
}

export function defaultCommitMessage(fileCount: number, projectName: string, isFirstPush: boolean): string {
  const countStr = fileCount === 1 ? "1 file" : `${fileCount} files`
  return isFirstPush ? `Export ${projectName}: ${countStr}` : `Update ${projectName}: ${countStr}`
}

export async function pushProject(token: string, opts: PushOptions): Promise<PushResult> {
  const { target, branch, message, files, linked, onProgress } = opts

  // 1. resolving-repo
  onProgress?.("resolving-repo")
  let owner: string
  let repoName: string
  let defaultBranch = "main"
  if (target.kind === "create") {
    const created = await createRepo(token, { name: target.name, private: target.private })
    owner = created.owner.login
    repoName = created.name
    if (created.default_branch) defaultBranch = created.default_branch
  } else {
    owner = target.owner
    repoName = target.name
  }

  let targetBranch: string
  let baseBranch: string
  let isNewBranch: boolean

  if (branch.mode === "new") {
    targetBranch = branch.name
    baseBranch = linked?.lastBranch || defaultBranch
    isNewBranch = true
  } else {
    targetBranch = linked?.lastBranch || defaultBranch
    baseBranch = targetBranch
    isNewBranch = false
  }

  // 2. reading-branch
  onProgress?.("reading-branch")
  let parentCommitSha: string | null = null
  let existingRefExists = false

  if (isNewBranch) {
    const existingTargetRef = await getRef(token, owner, repoName, `heads/${targetBranch}`)
    if (existingTargetRef) {
      parentCommitSha = existingTargetRef.object.sha
      existingRefExists = true
    } else {
      const baseRef = await getRef(token, owner, repoName, `heads/${baseBranch}`)
      if (baseRef) {
        parentCommitSha = baseRef.object.sha
      }
    }
  } else {
    const ref = await getRef(token, owner, repoName, `heads/${targetBranch}`)
    if (ref) {
      parentCommitSha = ref.object.sha
      existingRefExists = true
    }
  }

  // 3. building-tree (no base_tree: full-tree overwrite)
  onProgress?.("building-tree")
  const treeEntries = buildTreeEntries(files)
  let tree: { sha: string }
  try {
    tree = await createTree(token, owner, repoName, treeEntries)
  } catch (err) {
    if (
      err instanceof GithubApiError &&
      (err.status === 409 || err.message.toLowerCase().includes("git repository is empty"))
    ) {
      // Empty repositories cannot create a tree in GitHub's Git Data API without a baseline commit.
      // Initialize with a root commit via the Contents API, then retry createTree.
      const init = await initEmptyRepo(token, owner, repoName, targetBranch)
      parentCommitSha = init.commitSha
      existingRefExists = true
      tree = await createTree(token, owner, repoName, treeEntries)
    } else {
      throw err
    }
  }

  // 4. committing
  onProgress?.("committing")
  const parents = parentCommitSha ? [parentCommitSha] : []
  const commit = await createCommit(token, owner, repoName, {
    message,
    tree: tree.sha,
    parents,
  })

  // 5. updating-branch
  onProgress?.("updating-branch")
  if (existingRefExists) {
    try {
      await updateRef(token, owner, repoName, `heads/${targetBranch}`, commit.sha, false)
    } catch {
      await createRef(token, owner, repoName, targetBranch, commit.sha)
    }
  } else {
    await createRef(token, owner, repoName, targetBranch, commit.sha)
  }

  const htmlUrl = commit.html_url || `https://github.com/${owner}/${repoName}/commit/${commit.sha}`

  return {
    owner,
    name: repoName,
    branch: targetBranch,
    commitSha: commit.sha,
    htmlUrl,
  }
}
