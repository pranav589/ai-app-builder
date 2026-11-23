// Mounts every changed screen headlessly, using the SAME preview bundle the
// live canvas runs (public/preview/runtime.js), so the gate and what the
// user actually sees behave identically. A jsdom window loads the real
// bundle; this file plays "host" over the same bridge protocol
// (lib/preview/protocol.ts) the browser side (components/workspace/app-runtime.tsx)
// speaks, answering RPCs with a tiny in-memory store instead of a real backend.
//
// jsdom's own postMessage doesn't set MessageEvent.source, which the bundle's
// bridge relies on (`if (e.source !== window.parent) return`) to accept a
// message; a standalone jsdom window does have `window.parent === window`
// (verified by hand), so host -> frame messages are dispatched manually as
// MessageEvents with `source` set to the window itself, satisfying that
// check without touching jsdom internals. Frame -> host messages use the
// bundle's own (real) postMessage call, which jsdom delivers to our
// listener just fine; we don't check `source` on that side.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { JSDOM } from "jsdom"

import { BRIDGE_TAG, type FrameMessage, type HostMessage } from "@app/shared/preview/protocol"
import { compileForPreview, importsOf, isCodeFile, projectExports, resolveProjectImport } from "@app/shared/app-project/project"
import type { AppTheme } from "@app/shared/app-runtime/theme"
import type { Diagnostic, GateResult, Workspace } from "@app/shared/verify/types"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME_JS_PATH = process.env.PREVIEW_RUNTIME_JS_PATH || path.resolve(HERE, "../../../../../frontend/public/preview/runtime.js")
const MAX_PRESSES_PER_SCREEN = 12
const READY_TIMEOUT_MS = 5000
const SETTLE_MS = 40

type Rec = Record<string, unknown> & { id: string; createdAt: string }
type Snapshot = { collections: Record<string, Rec[]>; settings: Record<string, unknown>; user: { name: string; email: string } | null }

type Env = {
  win: Window & typeof globalThis
  post: (msg: HostMessage) => void
  /** The current check's state; only one check runs at a time (the module-level lock below). */
  current: { onFrameMessage: (m: FrameMessage) => void } | null
}

let envPromise: Promise<Env> | null = null

function getEnv(): Promise<Env> {
  envPromise ??= createEnv().catch((e) => {
    envPromise = null
    throw e
  })
  return envPromise
}

async function createEnv(): Promise<Env> {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"></div></body></html>`, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
  })
  const win = dom.window as unknown as Window & typeof globalThis

  // Not implemented by jsdom; the bundle (or React) touches these.
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(win as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver
  ;(win as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    media: "",
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true
    },
  })
  // React 19 reports event-handler errors through the global reportError.
  ;(win as unknown as { reportError: (e: unknown) => void }).reportError = (err: unknown) => {
    win.dispatchEvent(new win.ErrorEvent("error", { message: err instanceof Error ? err.message : String(err), error: err }))
  }

  const env: Env = {
    win,
    post: (msg) => win.dispatchEvent(new win.MessageEvent("message", { data: { ...msg, __app: BRIDGE_TAG }, source: win })),
    current: null,
  }

  win.addEventListener("message", (e: MessageEvent) => {
    const m = e.data as (FrameMessage & { __app?: string }) | null
    if (!m || m.__app !== BRIDGE_TAG) return
    env.current?.onFrameMessage(m)
  })

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The preview bundle never reported ready.")), READY_TIMEOUT_MS)
    env.current = {
      onFrameMessage: (m) => {
        if (m.kind === "ready") {
          clearTimeout(timer)
          resolve()
        }
      },
    }
  })

  ;(win as unknown as { __PREVIEW_CFG__: unknown }).__PREVIEW_CFG__ = { mode: "interactive", route: "/", platform: "ios", appName: "Verify" }
  const script = win.document.createElement("script")
  script.textContent = readFileSync(RUNTIME_JS_PATH, "utf8")
  win.document.body.appendChild(script)
  await ready
  env.current = null
  return env
}

// ---------------------------------------------------------------- in-memory backend

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function makeSnapshot(ws: Workspace): Snapshot {
  const collections: Record<string, Rec[]> = {}
  let settings: Record<string, unknown> = {}
  let user: Snapshot["user"] = null
  try {
    const seed = JSON.parse(ws.files["data/seed.json"] ?? "{}") as {
      collections?: Record<string, Record<string, unknown>[]>
      settings?: Record<string, unknown>
      user?: { name: string; email: string }
    }
    for (const [name, rows] of Object.entries(seed.collections ?? {})) {
      collections[name] = rows.map((r, i) => ({ ...r, id: String(r.id ?? `${name}-${i + 1}`), createdAt: (r.createdAt as string) ?? new Date().toISOString() }))
    }
    settings = seed.settings ?? {}
    user = seed.user ?? null
  } catch {
    // No seed yet (e.g. a brand new app mid-build); render with empty data.
  }
  return { collections, settings, user }
}

/** Mutates `snap` and returns the RPC's result, mirroring lib/backend/index.ts's device semantics closely enough to exercise a screen's data flow. */
function handleRpc(snap: Snapshot, method: string, args: Record<string, unknown>): unknown {
  const collection = typeof args.collection === "string" ? args.collection : ""
  switch (method) {
    case "db.insert": {
      const rec: Rec = { ...(args.values as Record<string, unknown>), id: newId(), createdAt: new Date().toISOString() }
      snap.collections[collection] = [rec, ...(snap.collections[collection] ?? [])]
      return rec
    }
    case "db.update": {
      const rows = snap.collections[collection] ?? []
      const i = rows.findIndex((r) => r.id === args.id)
      if (i === -1) throw new Error("That item no longer exists.")
      rows[i] = { ...rows[i], ...(args.patch as Record<string, unknown>), id: String(args.id), updatedAt: new Date().toISOString() }
      return rows[i]
    }
    case "db.remove":
      snap.collections[collection] = (snap.collections[collection] ?? []).filter((r) => r.id !== args.id)
      return null
    case "kv.set":
      snap.settings[String(args.key)] = args.value
      return null
    default:
      // auth.*, storage.upload, theme.set, ui.*: no-ops. Not meaningful headless, and never block a mount.
      return null
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

function activeTheme(ws: Workspace): AppTheme {
  try {
    const pkg = JSON.parse(ws.files["theme/themes.json"] ?? "{}") as { activeId?: string; themes?: AppTheme[] }
    const themes = pkg.themes ?? []
    return themes.find((t) => t.id === pkg.activeId) ?? themes[0] ?? FALLBACK_THEME
  } catch {
    return FALLBACK_THEME
  }
}

// ---------------------------------------------------------------- routes to check

const SCREEN_PATH = /^app\/.+\.(tsx|ts|jsx|js)$/
const isLayoutOrEntry = (p: string) => /_layout\.(tsx|ts|jsx|js)$/.test(p) || p === "app/index.tsx"

function pathnameOf(screenPath: string): string {
  const segs = screenPath
    .slice(4)
    .replace(/\.(tsx|ts|jsx|js)$/, "")
    .split("/")
  const url = segs.filter((s) => !/^\(.*\)$/.test(s))
  if (url[url.length - 1] === "index") url.pop()
  return "/" + url.join("/")
}

/** Only changed screens, and screens that import a changed component/lib file (transitively one level). */
function screensToCheck(ws: Workspace, changed?: string[]): string[] {
  const screens = Object.keys(ws.files).filter((p) => SCREEN_PATH.test(p) && !isLayoutOrEntry(p))
  if (!changed) return screens
  const changedSet = new Set(changed)
  return screens.filter((p) => {
    if (changedSet.has(p)) return true
    const code = ws.files[p]
    if (!code) return false
    return importsOf(code).some((spec) => {
      if (!spec.startsWith("@/") && !spec.startsWith(".")) return false
      const resolved = resolveProjectImport(p, spec, ws.files)
      return resolved !== null && changedSet.has(resolved)
    })
  })
}

// ---------------------------------------------------------------- the gate

/** VERIFY_DEBUG_INJECT=crash (ignored in production): throws from the first checked screen, to prove this gate blocks it. */
function debugInject(code: string): string {
  if (process.env.NODE_ENV === "production" || process.env.VERIFY_DEBUG_INJECT !== "crash") return code
  return `throw new Error("VERIFY_DEBUG_INJECT=crash");\n${code}`
}

export async function renderGate(ws: Workspace, changed?: string[]): Promise<GateResult> {
  const next = lock.then(() => check(ws, changed))
  lock = next.catch(() => {})
  return next
}

let lock: Promise<unknown> = Promise.resolve()

async function check(ws: Workspace, changed?: string[]): Promise<GateResult> {
  const t0 = performance.now()
  const screens = screensToCheck(ws, changed)
  if (!screens.length) return { gate: "render", ok: true, ms: performance.now() - t0, diagnostics: [] }

  let env: Env
  try {
    env = await getEnv()
  } catch (e) {
    return { gate: "render", ok: false, ms: performance.now() - t0, diagnostics: [{ gate: "render", code: "bundle_load", severity: "error", message: `The preview bundle failed to load: ${e instanceof Error ? e.message : String(e)}` }] }
  }

  const exports = projectExports(ws.files)
  const compiled: Record<string, string> = {}
  for (const [p, code] of Object.entries(ws.files)) {
    if (!isCodeFile(p) && !p.endsWith(".json")) continue
    try {
      compiled[p] = compileForPreview(p, code, exports)
    } catch {
      // A file that doesn't compile is caught by the parse gate already; skip it here.
    }
  }
  let injected = false
  for (const s of screens) {
    if (compiled[s] === undefined) continue
    if (!injected) {
      compiled[s] = debugInject(compiled[s])
      injected = true
    }
  }

  const theme = activeTheme(ws)
  const diagnostics: Diagnostic[] = []

  env.post({ kind: "modules", modules: compiled, planned: [] })
  env.post({ kind: "theme", theme, themes: [theme] })

  const seedBase = makeSnapshot(ws)
  let snap: Snapshot = { collections: structuredClone(seedBase.collections), settings: { ...seedBase.settings }, user: seedBase.user }
  const pushData = () => env.post({ kind: "data", data: { collections: snap.collections, settings: snap.settings, user: snap.user, signedIn: !!snap.user } })
  pushData()

  const firstSeedId = (): string | null => {
    for (const rows of Object.values(seedBase.collections)) if (rows[0]) return rows[0].id
    return null
  }

  const mount = async (route: string, press?: number) => {
    const errors: { message: string; file?: string }[] = []
    const logged: string[] = []
    const consoleError = console.error
    console.error = (...args: unknown[]) => logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
    env.current = {
      onFrameMessage: (m) => {
        if (m.kind === "error") errors.push({ message: m.message, file: m.file })
        else if (m.kind === "rpc") {
          let result: unknown = null
          let error: string | undefined
          try {
            result = handleRpc(snap, m.method, m.args)
          } catch (e) {
            error = e instanceof Error ? e.message : String(e)
          }
          env.post({ kind: "rpc-result", id: m.id, result: result ?? null, error })
          if (!error && /^(db\.|kv\.)/.test(m.method)) pushData()
        }
      },
    }
    try {
      env.post({ kind: "reset", route })
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      // The screen's own content, excluding header/tab-bar chrome (router.tsx testID="pv-screen-body"); a blank check against the whole page would always see the header's title text.
      const body = env.win.document.querySelector('[data-testid="pv-screen-body"]')
      const pressables = body ? [...body.querySelectorAll('[role="button"]')] : []
      let pressedLabel: string | undefined
      if (press !== undefined && pressables[press]) {
        const el = pressables[press] as HTMLElement
        pressedLabel = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60)
        el.dispatchEvent(new env.win.MouseEvent("click", { bubbles: true, cancelable: true, view: env.win }))
        await new Promise((r) => setTimeout(r, SETTLE_MS))
      }
      const blank = !errors.length && !!body && !body.textContent?.trim() && !body.querySelector("input, textarea, img")
      for (const l of logged) if (/Maximum update depth|Too many re-renders/.test(l)) errors.push({ message: l.slice(0, 300) })
      return { errors, blank, buttons: pressables.length, pressedLabel }
    } finally {
      console.error = consoleError
      env.current = null
    }
  }

  const describe = (screen: string, label: string, r: Awaited<ReturnType<typeof mount>>) => {
    for (const err of r.errors.slice(0, 1)) {
      diagnostics.push({ gate: "render", code: label.startsWith("press") ? "press_error" : "render_error", severity: "error", file: err.file ?? screen, message: `Screen "${screen}" ${label}: ${err.message}` })
    }
    if (r.blank) diagnostics.push({ gate: "render", code: "blank_screen", severity: "error", file: screen, message: `Screen "${screen}" ${label} rendered nothing visible. Show content, a loading state or an EmptyState.` })
  }

  for (const screen of screens.sort()) {
    const route = pathnameOf(screen)
    const before = diagnostics.length

    const onOpen = await mount(route)
    describe(screen, "on open", onOpen)

    const sampleId = firstSeedId()
    if (sampleId) {
      describe(screen, `with params {"id":"${sampleId}"}`, await mount(`${route}?id=${encodeURIComponent(sampleId)}`))
      describe(screen, `with an id that doesn't exist`, await mount(`${route}?id=missing-00000000`))
    }

    if (diagnostics.length === before) {
      for (let i = 0; i < Math.min(onOpen.buttons, MAX_PRESSES_PER_SCREEN); i++) {
        const r = await mount(route, i)
        if (r.errors.length) {
          describe(screen, `press "${r.pressedLabel ?? `button ${i + 1}`}"`, { ...r, blank: false })
          break
        }
      }
    }
  }

  const blocking = diagnostics.filter((d) => d.severity === "error")
  return { gate: "render", ok: blocking.length === 0, ms: performance.now() - t0, diagnostics }
}
