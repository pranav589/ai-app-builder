"use client"

import * as React from "react"

import type { BackendConfig } from "@/lib/app-runtime/app-doc"
import { emptyDataModel, type DataModel } from "@/lib/app-runtime/data-model"
import type { AppTheme } from "@/lib/app-runtime/theme"
import { compileForPreview, projectExports, type ProjectFiles } from "@/lib/app-project/project"
import { BackendError, createBackend, type AppBackend } from "@/lib/backend"
import { CloudHikeBackend } from "@/lib/backend/cloudhike-backend"
import {
  BRIDGE_TAG,
  type ElementEdit,
  type FrameConfig,
  type FrameMessage,
  type HostMessage,
  type PlannedRoute,
  type PreviewMode,
  type RuntimeSnapshot,
  type SelectedElement,
} from "@/lib/preview/protocol"

// The host side of the preview. Every frame (canvas screens and the
// interactive preview) runs the generated React Native app on
// react-native-web and registers here. This provider:
// - compiles the project's files (Sucrase) and ships them to every frame,
//   so a finished screen or edited component shows up everywhere at once,
// - pushes theme changes live (no rebuild, no reload),
// - answers data, auth and storage calls through the configured backend,
//   and pushes data changes to every frame,
// - hands native UI requests (alerts, share sheet, Face ID...) to the frame's owner.

export type FrameHandlers = {
  /** ui.* and native calls. Resolve with what the app should get back. */
  onNative?: (method: string, args: Record<string, unknown>) => Promise<unknown>
  onRoute?: (pathname: string) => void
  onError?: (message: string, file?: string) => void
  onSelectElement?: (el: SelectedElement) => void
  onDeselectElement?: () => void
  onElementRect?: (eid: string, rect: SelectedElement["rect"]) => void
}

type Entry = { handlers: React.RefObject<FrameHandlers> }

type RuntimeContextValue = {
  theme: AppTheme | null
  register: (win: Window, handlers: React.RefObject<FrameHandlers>) => () => void
  post: (win: Window, msg: HostMessage) => void
  /** Latest values, sent to a frame when it starts. */
  latest: React.RefObject<{ modules: Record<string, string>; planned: PlannedRoute[]; snapshot: RuntimeSnapshot; theme: AppTheme | null; themes: AppTheme[] }>
  resetData: () => Promise<void>
}

const RuntimeContext = React.createContext<RuntimeContextValue | null>(null)

export function useAppRuntime() {
  const ctx = React.useContext(RuntimeContext)
  if (!ctx) throw new Error("useAppRuntime must be used inside <AppRuntimeProvider>")
  return ctx
}

/** The active app theme, or null outside a runtime. */
export function useAppTheme() {
  return React.useContext(RuntimeContext)?.theme ?? null
}

const EMPTY_SNAPSHOT: RuntimeSnapshot = { collections: {}, settings: {}, user: null, signedIn: false }

const str = (v: unknown) => (typeof v === "string" ? v : "")
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Compiles changed files only; a file that doesn't compile becomes a module that throws a readable error. */
function useCompiled(files: ProjectFiles) {
  const cache = React.useRef(new Map<string, { src: string; key: string; out: string }>())
  return React.useMemo(() => {
    // Names the project's own files export, so a missing `import { TopBar }` is added.
    const local = projectExports(files)
    const key = Object.entries(local)
      .map(([n, e]) => `${n}@${e.module}`)
      .sort()
      .join(",")
    const out: Record<string, string> = {}
    for (const [path, src] of Object.entries(files)) {
      const hit = cache.current.get(path)
      if (hit && hit.src === src && hit.key === key) {
        out[path] = hit.out
        continue
      }
      let compiled: string
      try {
        compiled = compileForPreview(path, src, local)
      } catch (e) {
        const msg = `${path} doesn't compile: ${e instanceof Error ? e.message : String(e)}`
        compiled = `throw new Error(${JSON.stringify(msg)})`
      }
      cache.current.set(path, { src, key, out: compiled })
      out[path] = compiled
    }
    return out
  }, [files])
}

export function AppRuntimeProvider({
  appId,
  theme,
  themes,
  dataModel,
  backendConfig,
  files,
  planned,
  active,
  onThemeChange,
  onRuntimeError,
  children,
}: {
  /** Every runtime error from any frame (canvas or preview), for self-repair. */
  onRuntimeError?: (message: string, file?: string) => void
  appId: string
  theme: AppTheme | null
  themes: AppTheme[]
  dataModel: DataModel | null
  backendConfig: BackendConfig
  /** Every project file, screens included. */
  files: ProjectFiles
  planned: PlannedRoute[]
  /** Whether canvas or preview is actually visible: live-sync only polls while it is. */
  active: boolean
  onThemeChange?: (id: string) => void
  children: React.ReactNode
}) {
  const backend: AppBackend = React.useMemo(() => createBackend(appId, backendConfig), [appId, backendConfig])
  const model = React.useMemo(() => dataModel ?? emptyDataModel(), [dataModel])
  const modules = useCompiled(files)
  const frames = React.useRef(new Map<Window, Entry>())
  const latest = React.useRef({ modules, planned, snapshot: EMPTY_SNAPSHOT, theme, themes })
  latest.current = { ...latest.current, modules, planned, theme, themes }
  const collections = React.useRef(new Set<string>())
  const onThemeChangeRef = React.useRef(onThemeChange)
  onThemeChangeRef.current = onThemeChange
  const onRuntimeErrorRef = React.useRef(onRuntimeError)
  onRuntimeErrorRef.current = onRuntimeError

  const post = React.useCallback((win: Window, msg: HostMessage) => {
    try {
      // The frame's origin is opaque ("null"), so "*" is the only target that reaches it.
      win.postMessage({ ...msg, __app: BRIDGE_TAG }, "*")
    } catch {
      // A frame that went away.
    }
  }, [])

  const broadcast = React.useCallback(
    (msg: HostMessage) => {
      for (const win of frames.current.keys()) post(win, msg)
    },
    [post]
  )

  const sendTheme = React.useCallback(
    (win: Window) => {
      const { theme: t, themes: list } = latest.current
      if (t) post(win, { kind: "theme", theme: t, themes: list.length ? list : [t] })
    },
    [post]
  )

  const refresh = React.useCallback(async () => {
    const names = new Set([...model.collections.map((c) => c.name), ...collections.current])
    // A remote backend loads everything in one request; the local one reads each part.
    const bulk = backend instanceof CloudHikeBackend ? await backend.snapshot([...names]) : null
    const [lists, settings, user] = bulk
      ? [Object.entries(bulk.collections), bulk.settings, bulk.user]
      : await Promise.all([
          Promise.all([...names].map(async (n) => [n, await backend.db.list(n)] as const)),
          backend.kv.all(),
          backend.auth.current(),
        ])
    const next: RuntimeSnapshot = { collections: Object.fromEntries(lists), settings, user: user ?? model.user, signedIn: !!user }
    latest.current.snapshot = next
    broadcast({ kind: "data", data: next })
  }, [backend, model, broadcast])

  React.useEffect(() => () => (backend as { dispose?: () => void }).dispose?.(), [backend])

  // Seed (or reseed after a plan change) and load the data. Nobody's looking
  // at canvas/preview while this is inactive, so skip the live-sync poll.
  React.useEffect(() => {
    if (!active) return
    let alive = true
    void backend
      .init(model)
      .then(() => {
        if (alive) return refresh()
      })
      .catch((e) => console.error("app backend failed to start", e))
    const off = backend.subscribe(() => void refresh().catch(() => {}))
    return () => {
      alive = false
      off()
    }
  }, [backend, model, refresh, active])

  // New code reaches every frame; each re-renders in place.
  React.useEffect(() => {
    broadcast({ kind: "modules", modules, planned })
  }, [modules, planned, broadcast])

  // A theme switch only swaps the tokens screens read: no rebuild, no reload.
  React.useEffect(() => {
    for (const win of frames.current.keys()) sendTheme(win)
  }, [theme, themes, sendTheme])

  const persistMedia = React.useCallback(
    async (values: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) {
        out[k] = typeof v === "string" && v.startsWith("data:") ? (await backend.storage.upload({ dataUrl: v })).url : v
      }
      return out
    },
    [backend]
  )

  const handleRpc = React.useCallback(
    async (entry: Entry, method: string, args: Record<string, unknown>): Promise<unknown> => {
      const collection = str(args.collection)
      if (collection) collections.current.add(collection)
      switch (method) {
        case "db.insert":
          return backend.db.insert(collection, await persistMedia(obj(args.values)))
        case "db.update":
          return backend.db.update(collection, str(args.id), await persistMedia(obj(args.patch)))
        case "db.remove":
          return backend.db.remove(collection, str(args.id))
        case "kv.set":
          return backend.kv.set(str(args.key), args.value)
        case "storage.upload":
          return backend.storage.upload({ dataUrl: str(args.dataUrl), name: str(args.name) || undefined })
        case "auth.signin":
          return backend.auth.signIn({ email: str(args.email), password: str(args.password) })
        case "auth.signup":
          return backend.auth.signUp({ name: str(args.name), email: str(args.email), password: str(args.password) })
        case "auth.reset":
          return backend.auth.resetPassword({ email: str(args.email) })
        case "auth.signOut":
          return backend.auth.signOut()
        case "theme.set":
          onThemeChangeRef.current?.(str(args.id))
          return null
        default:
          if (method.startsWith("ui.") || method === "native") {
            return entry.handlers.current?.onNative ? entry.handlers.current.onNative(method, args) : null
          }
          throw new BackendError("That action isn't supported yet.")
      }
    },
    [backend, persistMedia]
  )

  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = e.source as Window | null
      if (!win) return
      const entry = frames.current.get(win)
      const msg = e.data as (FrameMessage & { __app?: string }) | null
      if (!entry || !msg || msg.__app !== BRIDGE_TAG) return
      switch (msg.kind) {
        case "ready": {
          const l = latest.current
          sendTheme(win)
          post(win, { kind: "data", data: l.snapshot })
          post(win, { kind: "modules", modules: l.modules, planned: l.planned })
          break
        }
        case "rpc":
          handleRpc(entry, String(msg.method), obj(msg.args)).then(
            (result) => post(win, { kind: "rpc-result", id: msg.id, result: result ?? null }),
            (err) =>
              post(win, {
                kind: "rpc-result",
                id: msg.id,
                error: err instanceof BackendError ? err.message : "Something went wrong. Please try again.",
              })
          )
          break
        case "route":
          entry.handlers.current?.onRoute?.(msg.pathname)
          break
        case "error":
          entry.handlers.current?.onError?.(msg.message, msg.file)
          onRuntimeErrorRef.current?.(msg.message, msg.file)
          break
        case "select":
          entry.handlers.current?.onSelectElement?.(msg.element)
          break
        case "deselect":
          entry.handlers.current?.onDeselectElement?.()
          break
        case "element-rect":
          entry.handlers.current?.onElementRect?.(msg.eid, msg.rect)
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [handleRpc, post, sendTheme])

  const register = React.useCallback((win: Window, handlers: React.RefObject<FrameHandlers>) => {
    frames.current.set(win, { handlers })
    return () => {
      if (frames.current.get(win)?.handlers === handlers) frames.current.delete(win)
    }
  }, [])

  const resetData = React.useCallback(() => backend.reset(), [backend])

  const value = React.useMemo<RuntimeContextValue>(() => ({ theme, register, post, latest, resetData }), [theme, register, post, resetData])
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

// Frames load the runtime from our origin; everything else stays blocked.
function frameDocument(config: FrameConfig) {
  const origin = window.location.origin
  const csp = [
    "default-src 'none'",
    `script-src ${origin} 'unsafe-inline' 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    `font-src ${origin} data:`,
    // Our origin serves files apps store in their CloudHike bucket (/api/app-files).
    // https: covers remote photos the app references (ImageKit-hosted or
    // user-picked URLs); the frame is sandboxed with no same-origin access,
    // so it carries no cookies/credentials for those requests to leak.
    `img-src data: blob: https: ${origin}`,
    "media-src data: blob:",
  ].join("; ")
  const cfg = JSON.stringify(config).replace(/</g, "\\u003c")
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Ionicons;src:url(${origin}/preview/Ionicons.ttf) format("truetype");font-display:block}</style></head><body><div id="root"></div><script>window.__PREVIEW_CFG__=${cfg}</script><script src="${origin}/preview/runtime.js"></script></body></html>`
}

/**
 * One app frame. Sandboxed with scripts but without same-origin access: the
 * generated code can't touch the workspace, its cookies or its storage.
 */
export function RuntimeFrame({
  route,
  mode,
  platform = "ios",
  appName,
  handlers,
  inspect = false,
  edit,
  deselectKey,
  selectParentKey,
  resetKey,
  className,
  style,
}: {
  /** Pathname the app opens on, e.g. "/home". */
  route: string
  mode: PreviewMode
  platform?: "ios" | "android"
  appName: string
  handlers?: FrameHandlers
  /** Hover/select elements (for the inline editor). */
  inspect?: boolean
  edit?: ElementEdit | null
  /** Changing it clears the frame's current selection (Edit Mode stays on). */
  deselectKey?: unknown
  /** Changing it selects the element around the current selection. */
  selectParentKey?: unknown
  /** Changing it sends the app back to `route` without reloading. */
  resetKey?: unknown
  className?: string
  style?: React.CSSProperties
}) {
  const { register, post } = useAppRuntime()
  const ref = React.useRef<HTMLIFrameElement>(null)
  const handlersRef = React.useRef<FrameHandlers>(handlers ?? {})
  handlersRef.current = handlers ?? {}

  // Built once in the browser (it needs our origin); code, theme and data then arrive as messages.
  const [doc, setDoc] = React.useState<string | null>(null)
  const initial = React.useRef({ mode, route, platform, appName })
  React.useEffect(() => setDoc(frameDocument(initial.current)), [])

  React.useEffect(() => {
    const win = ref.current?.contentWindow
    if (!win) return
    return register(win, handlersRef)
  }, [register, doc])

  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const win = ref.current?.contentWindow
    if (win) post(win, { kind: "reset", route })
  }, [route, resetKey, post])

  React.useEffect(() => {
    const win = ref.current?.contentWindow
    if (win) post(win, { kind: "inspect", enabled: inspect })
  }, [inspect, post])

  React.useEffect(() => {
    const win = ref.current?.contentWindow
    if (win && edit) post(win, { kind: "apply-edit", edit })
  }, [edit, post])

  const firstDeselect = React.useRef(true)
  React.useEffect(() => {
    if (firstDeselect.current) {
      firstDeselect.current = false
      return
    }
    const win = ref.current?.contentWindow
    if (win) post(win, { kind: "deselect" })
  }, [deselectKey, post])

  const firstParent = React.useRef(true)
  React.useEffect(() => {
    if (firstParent.current) {
      firstParent.current = false
      return
    }
    const win = ref.current?.contentWindow
    if (win) post(win, { kind: "select-parent" })
  }, [selectParentKey, post])

  return (
    <iframe
      ref={ref}
      title="App preview"
      srcDoc={doc ?? undefined}
      sandbox="allow-scripts allow-forms"
      className={className}
      style={style}
      onLoad={() => {
        const win = ref.current?.contentWindow
        if (win && inspect) post(win, { kind: "inspect", enabled: true })
      }}
    />
  )
}
