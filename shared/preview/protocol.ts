// Messages between the workspace (host) and a preview frame running a
// generated React Native app on react-native-web. Shared by both sides.
//
// The frame is sandboxed without same-origin access: it has no storage or
// network of its own. App data, auth, file storage and native system UI all
// go through these messages to the host, which talks to the app's backend
// (local storage, or the provider the creator connected).

import type { AppTheme } from "@app/shared/app-runtime/theme"

export const BRIDGE_TAG = "anything-preview/1"

export type PreviewMode = "static" | "interactive"

export type RuntimeSnapshot = {
  collections: Record<string, Record<string, unknown>[]>
  settings: Record<string, unknown>
  user: { name: string; email: string; avatar?: string } | null
  signedIn: boolean
}

/** Planned screens, so the app can say "still being built" instead of "missing". */
export type PlannedRoute = { pathname: string; name: string; state: "pending" | "generating" | "ready" | "error" }

export type FrameConfig = {
  mode: PreviewMode
  /** Pathname the app opens on, e.g. "/home". */
  route: string
  platform: "ios" | "android"
  appName: string
}

/** What the inline editor learns about a picked element. */
export type SelectedElement = {
  /** "file:line:Type", e.g. "app/(tabs)/home.tsx:42:Text". Points at the JSX in the source. */
  eid: string
  tag: string
  /** The element's one piece of text (its own, or a kit component's label/title), or null when it has none or several. */
  text: string | null
  /** A @/kit component used at this line: its look comes from kit props (tone, variant...), so style overrides don't apply. */
  kit: boolean
  rect: { x: number; y: number; width: number; height: number }
  styles: Record<string, string>
  /** The tag of the nearest editable element around this one, or null at the top: what "select parent" would pick. */
  parent: string | null
  /** For image elements: the current image source URL if available */
  imageSrc?: string | null
}

/** A selected element as the chat and the AI agent see it: enough to find it again in the source. */
export type ElementRef = {
  /** "file:line:Type", the JSX the element came from. */
  eid: string
  tag: string
  /** What it shows, when it has one piece of text. */
  text: string | null
  screenId?: string
  screenName?: string
}

export type ElementEdit = {
  eid: string
  text?: string
  /** The text being replaced, as it currently is in the source: picks the right element/prop when a line has several. */
  from?: string
  style?: Record<string, string>
  /** The new image source URL to write into JSX (for Image / ExpoImage components) */
  imageSrc?: string
}

/** Frame -> host. */
export type FrameMessage =
  | { kind: "ready" }
  | { kind: "rpc"; id: number; method: string; args: Record<string, unknown> }
  | { kind: "route"; pathname: string }
  | { kind: "error"; message: string; file?: string }
  | { kind: "select"; element: SelectedElement }
  /** Edit Mode: a tap on nothing editable. */
  | { kind: "deselect" }
  /** The selected element moved or resized (after an edit, or a scroll inside the app). */
  | { kind: "element-rect"; eid: string; rect: SelectedElement["rect"] }

/** Host -> frame. */
export type HostMessage =
  | { kind: "rpc-result"; id: number; result?: unknown; error?: string }
  /** Compiled CommonJS modules by project path; JSON files are sent raw. */
  | { kind: "modules"; modules: Record<string, string>; planned: PlannedRoute[] }
  | { kind: "theme"; theme: AppTheme; themes: AppTheme[] }
  | { kind: "data"; data: RuntimeSnapshot }
  | { kind: "reset"; route: string }
  | { kind: "inspect"; enabled: boolean }
  | { kind: "apply-edit"; edit: ElementEdit }
  /** Clears the current selection but keeps Edit Mode on. */
  | { kind: "deselect" }
  /** Selects the editable element around the current selection. */
  | { kind: "select-parent" }
