// Shared by the server (agent runs) and the browser (workspace UI).

import type { DataModel } from "@/lib/app-runtime/data-model"
import type { ThemePackage } from "@/lib/app-runtime/theme"

export type PlanScreen = {
  /** Stable kebab-case id, e.g. "home". Kept across plan revisions. */
  id: string
  name: string
  purpose: string
  keyElements: string[]
  navigatesTo: string[]
  /** How the screen is reached: a bottom tab, pushed onto the stack, or a modal sheet. */
  presentation: "tab" | "stack" | "modal"
}

export type DesignDirection = {
  style: string
  primaryColor: string
  accentColor: string
  backgroundColor: string
  surfaceColor: string
  textColor: string
  cornerRadius: "sharp" | "soft" | "round"
  typography: string
}

export type AppPlan = {
  appName: string
  summary: string
  targetUsers: string
  coreFeatures: string[]
  design: DesignDirection
  navigation: string
  screens: PlanScreen[]
}

/** Project lifecycle, stored in projects.status. */
export type AgentPhase = "draft" | "planning" | "awaiting_approval" | "generating" | "ready"

export type ScreenState = "pending" | "generating" | "ready" | "error"

export type GeneratedScreen = {
  id: string
  name: string
  state: ScreenState
  /** Project file of the screen, e.g. "app/(tabs)/home.tsx". */
  path?: string
  /** React Native (Expo Router) source of the screen. */
  code?: string
  /** Hash of the plan entry the html was built from; a changed plan regenerates it. */
  specHash?: string
  error?: string
}

export type BuildProgress = {
  screens: { id: string; name: string; state: ScreenState }[]
}

export type ChatMessageKind = "standard" | "plan" | "build"

export type StoredMessage = {
  id: string
  sender: "user" | "assistant"
  kind: ChatMessageKind
  text: string
  createdAt: string
  plan?: AppPlan
  build?: BuildProgress
}

/** The app's backend as the workspace shows it. Never carries credentials. */
export type BackendInfo = {
  provider: "cloudhike"
  status: "provisioning" | "ready" | "error"
  projectId: string | null
  projectName: string | null
  services: string[]
  /** "reconnect" when the CloudHike account must be connected again; otherwise a message for the creator. */
  error: string | null
  connectedAt: string | null
}

/** Events streamed from POST /api/projects/[id]/agent as server-sent events. */
export type AgentEvent =
  | { type: "phase"; phase: AgentPhase }
  | { type: "status"; text: string }
  | { type: "project"; name: string }
  | { type: "message_start"; id: string }
  | { type: "text"; id: string; delta: string }
  | { type: "plan_progress"; screens: string[] }
  | { type: "message_done"; message: StoredMessage }
  | { type: "build_start"; message: StoredMessage; screens: GeneratedScreen[] }
  /** The theme package and data model the screens are built on. */
  | { type: "foundation"; themes: ThemePackage; data: DataModel }
  /** Project files other than screens (layouts, components, config), whole set. */
  | { type: "files"; files: Record<string, string> }
  | { type: "screen_start"; id: string; index: number; total: number }
  | { type: "screen_delta"; id: string; delta: string }
  | { type: "screen_done"; screen: GeneratedScreen }
  | { type: "build_progress"; messageId: string; build: BuildProgress }
  | { type: "snapshot"; status: string | null; message?: { id: string; text: string }; screen?: { id: string; code: string } }
  /** The app's backend changed (setting up, connected, failed). */
  | { type: "backend"; backend: BackendInfo }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "busy" }
  | { type: "done" }
