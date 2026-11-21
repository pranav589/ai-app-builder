// Shared API contracts and entity types for the web frontend, mobile client, and backend service.

export interface User {
  id: string
  name: string | null
  email: string
  credits: number
  createdAt: Date | string
  updatedAt: Date | string
}

export interface ProjectAsset {
  id: string
  name: string
  type: string
  size: number
  key: string
  url?: string | null
}

export interface Project {
  id: string
  userId: string | null
  name: string
  tagline: string | null
  description: string | null
  category: string | null
  platform: string | null
  screensCount: number | null
  status: string | null
  themeColor: string | null
  gradient: string | null
  previewScreens: unknown
  createdAt: Date | string
  updatedAt: Date | string
  prompt: string | null
  assets: ProjectAsset[] | null
  engine: string
  currentVersion: number
  isPublic: boolean
  publicSlug: string | null
}

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface AgentRunRow {
  id: string
  projectId: string
  kind: string
  input: unknown
  status: AgentRunStatus
  jobId: string | null
  attempts: number
  error: string | null
  createdAt: Date | string
  startedAt: Date | string | null
  heartbeatAt: Date | string | null
  finishedAt: Date | string | null
}

export interface AppSnapshotRow {
  id: string
  projectId: string
  version: number
  prompt: string | null
  patch: unknown
  files: Record<string, string>
  status: string
  error: string | null
  createdAt: Date | string
}

export type BackendStatus = "provisioning" | "ready" | "error"

export interface AppBackendRow {
  id: string
  projectId: string
  status: BackendStatus
  connectionId: string | null
  error: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface GithubConnectionRow {
  id: string
  userId: string
  username: string
  avatarUrl: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface ProjectGithubLinkRow {
  projectId: string
  repoOwner: string
  repoName: string
  branch: string
  repoUrl: string
  lastPushedAt: Date | string | null
  lastCommitSha: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export type BuildPlatform = "android" | "ios"
export type BuildFormat = "aab" | "apk" | "ipa"
export type BuildStatus = "queued" | "dispatching" | "building" | "ready" | "failed"

export interface BuildRow {
  id: string
  projectId: string
  platform: BuildPlatform
  format: BuildFormat
  status: BuildStatus
  version?: string | null
  workflowRunId: string | null
  workflowRunUrl?: string | null
  artifactUrl: string | null
  gitCommitSha: string | null
  error: string | null
  needsIosCredentials?: number | boolean
  createdAt: Date | string
  updatedAt: Date | string
}

export interface ProjectAppIdentityRow {
  projectId: string
  androidPackage: string
  iosBundleId: string
  slug: string
  createdAt: Date | string
  updatedAt: Date | string
}

export interface ExpoConnectionRow {
  id: string
  userId: string
  username: string
  avatarUrl: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export type WebDeployStatus = "queued" | "dispatching" | "building" | "deploying" | "ready" | "failed"

export interface WebDeploymentRow {
  id: string
  projectId: string
  status: WebDeployStatus
  url: string | null
  lastDeployRunId: string | null
  gitCommitSha: string | null
  workflowRunUrl?: string | null
  lastDeployedAt?: Date | string | null
  error: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface WebDeployRunRow {
  id: string
  deploymentId: string
  projectId: string
  status: WebDeployStatus
  url?: string | null
  workflowRunId: string | null
  workflowRunUrl?: string | null
  gitCommitSha: string | null
  error: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export type DeviceBuildStatus = "building" | "ready" | "failed"

export interface DeviceBuildRow {
  id: string
  projectId: string
  status: DeviceBuildStatus
  downloadUrl: string | null
  manifestUrl: string | null
  error: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export type PushStep = "resolving-repo" | "reading-branch" | "building-tree" | "committing" | "updating-branch"

export interface WorkspaceResponse {
  project: {
    id: string
    name: string
    prompt: string
    phase: string
    platform: string | null
    createdAt: string
    assets: Array<{ id: string; name: string; type: string; size: number; url: string | null }>
    screens: unknown[]
    themes: unknown
    dataModel: unknown
    files: Record<string, string>
    backend?: unknown
    backendInfo?: unknown
    cloudhike: { configured: boolean; accountConnected: boolean }
    isPublic: boolean
    publicSlug: string | null
  }
  messages: unknown[]
}

