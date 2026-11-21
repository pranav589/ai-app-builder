export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly responseData?: unknown
  ) {
    super(message)
    this.name = "GithubApiError"
  }
}

export type TreeEntry = {
  path: string
  mode: "100644" | "100755" | "040000" | "160000" | "120000"
  type: "blob" | "tree" | "commit"
  content: string
}

export type GithubRepo = {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  private: boolean
  default_branch?: string
  html_url: string
}

export type GithubRef = {
  ref: string
  object: {
    sha: string
    type: string
  }
}

export type GithubCommit = {
  sha: string
  html_url?: string
  tree: {
    sha: string
  }
}

async function githubFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path.startsWith("/") ? path : `/${path}`}`
  const headers = new Headers(init?.headers)
  headers.set("authorization", `Bearer ${token}`)
  headers.set("accept", "application/vnd.github+json")
  headers.set("x-github-api-version", "2022-11-28")
  headers.set("user-agent", "Anything-App-Builder")

  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining")
    let data: Record<string, unknown> = {}
    try {
      data = (await res.json()) as Record<string, unknown>
    } catch {}

    const message = (typeof data.message === "string" ? data.message : "") || `GitHub API error (${res.status})`

    let code: string | undefined
    if (res.status === 401) code = "auth_expired"
    else if (res.status === 403 && remaining === "0") code = "rate_limited"
    else if (res.status === 422) {
      const errStr = JSON.stringify(data).toLowerCase()
      if (errStr.includes("already exists") || errStr.includes("name already exists")) code = "name_conflict"
      else code = "validation_failed"
    }

    throw new GithubApiError(message, res.status, code, data)
  }

  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
  return githubFetch<GithubRepo[]>(token, "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member")
}

export async function getRepo(token: string, owner: string, repo: string): Promise<GithubRepo> {
  return githubFetch<GithubRepo>(token, `/repos/${owner}/${repo}`)
}

export async function createRepo(
  token: string,
  opts: { name: string; private: boolean; auto_init?: boolean }
): Promise<GithubRepo> {
  return githubFetch<GithubRepo>(token, "/user/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: opts.name, private: opts.private, auto_init: opts.auto_init ?? true }),
  })
}

/** Initializes an empty repository with an initial commit so GitHub's Git Data API can create trees. */
export async function initEmptyRepo(
  token: string,
  owner: string,
  repo: string,
  branch = "main"
): Promise<{ commitSha: string }> {
  const content = Buffer.from(`# ${repo}\n`).toString("base64")
  const res = await githubFetch<{ commit: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/contents/README.md`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Initial commit",
        content,
        branch,
      }),
    }
  )
  return { commitSha: res.commit.sha }
}

export async function getRef(token: string, owner: string, repo: string, ref: string): Promise<GithubRef | null> {
  const cleanRef = ref.replace(/^refs\//, "")
  try {
    return await githubFetch<GithubRef>(token, `/repos/${owner}/${repo}/git/ref/${cleanRef}`)
  } catch (err) {
    if (
      err instanceof GithubApiError &&
      (err.status === 404 ||
        err.status === 409 ||
        err.message.toLowerCase().includes("git repository is empty"))
    ) {
      return null
    }
    throw err
  }
}

export async function getCommit(token: string, owner: string, repo: string, commitSha: string): Promise<GithubCommit> {
  return githubFetch<GithubCommit>(token, `/repos/${owner}/${repo}/git/commits/${commitSha}`)
}

export async function createTree(token: string, owner: string, repo: string, tree: TreeEntry[]): Promise<{ sha: string }> {
  return githubFetch<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tree }),
  })
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  opts: { message: string; tree: string; parents: string[] }
): Promise<GithubCommit> {
  return githubFetch<GithubCommit>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: opts.message, tree: opts.tree, parents: opts.parents }),
  })
}

export async function createRef(token: string, owner: string, repo: string, ref: string, sha: string): Promise<GithubRef> {
  const fullRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`
  return githubFetch<GithubRef>(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: fullRef, sha }),
  })
}

export async function updateRef(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  sha: string,
  force = false
): Promise<GithubRef> {
  const cleanRef = ref.replace(/^refs\//, "")
  return githubFetch<GithubRef>(token, `/repos/${owner}/${repo}/git/refs/${cleanRef}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha, force }),
  })
}

export type ActionsPublicKey = {
  key_id: string
  key: string
}

export async function getActionsPublicKey(
  token: string,
  owner: string,
  repo: string
): Promise<ActionsPublicKey> {
  return githubFetch<ActionsPublicKey>(token, `/repos/${owner}/${repo}/actions/secrets/public-key`)
}

export async function createOrUpdateRepoSecret(
  token: string,
  owner: string,
  repo: string,
  secretName: string,
  encryptedValue: string,
  keyId: string
): Promise<void> {
  await githubFetch<void>(token, `/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
  })
}

export async function dispatchWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowId: string,
  ref: string,
  inputs: Record<string, string>
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await githubFetch<void>(token, `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref, inputs }),
      })
      return
    } catch (err) {
      lastErr = err
      if (err instanceof GithubApiError && err.status === 404 && attempt < 2) {
        // Ref propagation or workflow indexing lag: retry after 2 seconds
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      throw err
    }
  }
  if (lastErr) throw lastErr
}

export type WorkflowRun = {
  id: number
  html_url: string
  created_at: string
  status: string
  conclusion: string | null
}

export async function listWorkflowRuns(
  token: string,
  owner: string,
  repo: string,
  workflowId: string,
  params?: { event?: string; created?: string }
): Promise<{ total_count: number; workflow_runs: WorkflowRun[] }> {
  const query = new URLSearchParams()
  if (params?.event) query.set("event", params.event)
  if (params?.created) query.set("created", params.created)
  query.set("per_page", "10")
  const qs = query.toString() ? `?${query.toString()}` : ""
  return githubFetch<{ total_count: number; workflow_runs: WorkflowRun[] }>(
    token,
    `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs${qs}`
  )
}

