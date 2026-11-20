// The generated app as stored in projects.preview_screens. Older projects
// stored a bare array of screens there; readAppDoc accepts both shapes.

import type { GeneratedScreen } from "@/lib/agent/types"
import type { AppManifest } from "@/lib/manifest/schema"
import type { PlannedRoute } from "@/lib/preview/protocol"
import type { DataModel } from "./data-model"
import type { ThemePackage } from "./theme"

export type BackendConfig =
  /** Data lives in the browser (default until a CloudHike account is connected). */
  | { provider: "local" }
  /** Filled in when the creator connects CloudHike. */
  | { provider: "cloudhike"; projectRef: string; region?: string }

export type AppDoc = {
  v: 2
  screens: GeneratedScreen[]
  /** Every project file except screens: layouts, the app's own components, platform modules, config. */
  files?: Record<string, string>
  /** Hash of the plan parts the AI-written shell (layouts, components) was made from. */
  shellHash?: string
  /** Hash of the plan parts the shared components were made from (the design); layouts can change without them. */
  componentsHash?: string
  themes?: ThemePackage
  data?: DataModel
  backend: BackendConfig
  /** Verified-engine apps only (Phase 6); migrated lazily on first open (lib/manifest/migrate.ts fromLegacy). */
  manifest?: AppManifest
}

/** Every project file the runtime needs to compile: platform/shared files plus each finished screen. */
export function mergeScreensIntoFiles(files: Record<string, string> | undefined, screens: GeneratedScreen[]): Record<string, string> {
  const out: Record<string, string> = { ...(files ?? {}) }
  for (const s of screens) if (s.state === "ready" && s.code && s.path) out[s.path] = s.code
  return out
}

/** Every project file the runtime needs to compile, read straight off an AppDoc. */
export function projectFilesFromDoc(doc: AppDoc): Record<string, string> {
  return mergeScreensIntoFiles(doc.files, doc.screens)
}

/** The app's own router needs every screen's route to navigate between them. */
export function plannedRoutesFromScreens(screens: GeneratedScreen[]): PlannedRoute[] {
  return screens.map((s) => ({ pathname: `/${s.id}`, name: s.name, state: s.state }))
}

export function readAppDoc(raw: unknown): AppDoc {
  if (Array.isArray(raw)) return { v: 2, screens: raw as GeneratedScreen[], backend: { provider: "local" } }
  if (raw && typeof raw === "object" && (raw as { v?: unknown }).v === 2) {
    const d = raw as Partial<AppDoc>
    return {
      v: 2,
      screens: Array.isArray(d.screens) ? d.screens : [],
      files: d.files && typeof d.files === "object" ? d.files : undefined,
      shellHash: d.shellHash,
      componentsHash: d.componentsHash,
      themes: d.themes,
      data: d.data,
      backend: d.backend ?? { provider: "local" },
      manifest: d.manifest,
    }
  }
  return { v: 2, screens: [], backend: { provider: "local" } }
}
