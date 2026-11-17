// The frame's side of the host connection, plus the small stores the
// shims read from (theme, data, compiled modules).

import { BRIDGE_TAG, type FrameConfig, type FrameMessage, type HostMessage, type PlannedRoute, type RuntimeSnapshot } from "@/lib/preview/protocol"
import type { AppTheme } from "@/lib/app-runtime/theme"

declare global {
  interface Window {
    __PREVIEW_CFG__?: FrameConfig
  }
}

export const config: FrameConfig = window.__PREVIEW_CFG__ ?? { mode: "interactive", route: "/", platform: "ios", appName: "App" }

export function post(msg: FrameMessage) {
  try {
    window.parent.postMessage({ ...msg, __app: BRIDGE_TAG }, "*")
  } catch {
    // Detached frame.
  }
}

let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

export function rpc<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    post({ kind: "rpc", id, method, args })
  })
}

/** A tiny external store usable with React's useSyncExternalStore. */
export function createStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      for (const l of listeners) l()
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

const FALLBACK_THEME: AppTheme = {
  id: "default",
  name: "Default",
  mode: "light",
  radius: "soft",
  colors: {
    primary: "#2f5bea",
    onPrimary: "#ffffff",
    primarySoft: "#e8eefd",
    accent: "#f59e0b",
    onAccent: "#111111",
    background: "#f6f7f9",
    surface: "#ffffff",
    surfaceAlt: "#f0f1f4",
    text: "#111318",
    textMuted: "#5f6470",
    border: "#e4e6ea",
    success: "#16a34a",
    warning: "#d97706",
    danger: "#dc2626",
  },
}

export const themeStore = createStore<{ theme: AppTheme; themes: AppTheme[] }>({ theme: FALLBACK_THEME, themes: [FALLBACK_THEME] })
export const dataStore = createStore<RuntimeSnapshot>({ collections: {}, settings: {}, user: null, signedIn: false })
export const moduleStore = createStore<{ modules: Record<string, string>; planned: PlannedRoute[]; version: number }>({
  modules: {},
  planned: [],
  version: 0,
})

type Handlers = {
  reset?: (route: string) => void
  inspect?: (enabled: boolean) => void
  applyEdit?: (edit: Extract<HostMessage, { kind: "apply-edit" }>["edit"]) => void
}
export const handlers: Handlers = {}

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return
  const m = e.data as (HostMessage & { __app?: string }) | null
  if (!m || m.__app !== BRIDGE_TAG) return
  switch (m.kind) {
    case "rpc-result": {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error))
      else p.resolve(m.result)
      break
    }
    case "theme":
      themeStore.set({ theme: m.theme, themes: m.themes })
      break
    case "data":
      dataStore.set(m.data)
      break
    case "modules":
      moduleStore.set({ modules: m.modules, planned: m.planned, version: moduleStore.get().version + 1 })
      break
    case "reset":
      handlers.reset?.(m.route)
      break
    case "inspect":
      handlers.inspect?.(m.enabled)
      break
    case "apply-edit":
      handlers.applyEdit?.(m.edit)
      break
  }
})
