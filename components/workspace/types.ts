import type { AgentPhase, BackendInfo, GeneratedScreen, StoredMessage } from "@/lib/agent/types"
import type { BackendConfig } from "@/lib/app-runtime/app-doc"
import type { DataModel } from "@/lib/app-runtime/data-model"
import type { ThemePackage } from "@/lib/app-runtime/theme"

export type WorkspaceAsset = {
  id: string
  name: string
  type: string
  size: number
  url: string | null
}

export type WorkspaceProject = {
  id: string
  name: string
  prompt: string
  phase: AgentPhase
  platform: string | null
  createdAt: string
  assets: WorkspaceAsset[]
  screens: GeneratedScreen[]
  themes: ThemePackage | null
  dataModel: DataModel | null
  /** Project files other than screens. */
  files: Record<string, string>
  backend: BackendConfig
  /** The app's CloudHike backend (status only, never credentials). */
  backendInfo: BackendInfo | null
  cloudhike: { configured: boolean; accountConnected: boolean }
  isPublic: boolean
  publicSlug: string | null
}

export type ChatMessage = StoredMessage & {
  /** Shown under the first user message. */
  assets?: WorkspaceAsset[]
}

/** A generated screen placed on the canvas. */
export type ScreenNode = GeneratedScreen & { x: number; y: number }

/** Who owns a file: the AI (app), platform templates, or the manifest compiler (Phase 9). */
export type FileOwner = "app" | "platform" | "generated"

export type FileNode =
  | { type: "folder"; name: string; path: string; children: FileNode[] }
  | { type: "file"; name: string; path: string; language: string; content: string; owner: FileOwner }
