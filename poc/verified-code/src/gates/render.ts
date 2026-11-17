import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { JSDOM } from "jsdom"
import { transform } from "sucrase"

import type { Diagnostic, GateResult } from "../core/types"
import { SDK_DIR, SDK_MODULES, type Workspace } from "../core/workspace"

// Render smoke test: mounts every screen of the app (react-native-web in jsdom),
// with sample params, again with a record id that doesn't exist, and once per
// button with that button pressed. Crashes, render loops and blank screens fail.

const nodeRequire = createRequire(import.meta.url)
const MAX_PRESSES_PER_SCREEN = 12

type Env = { React: typeof import("react"); ReactDOMClient: typeof import("react-dom/client"); RNW: unknown; document: Document }
let env: Env | null = null
/** Where errors reported outside React's render (event handlers, timers) go during a mount. */
let errorSink: (err: unknown) => void = () => {}

function setupDom(): Env {
  if (env) return env
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" })
  const w = dom.window as unknown as Record<string, unknown>
  const g = globalThis as Record<string, unknown>
  const define = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  define("window", w)
  define("document", w.document)
  define("navigator", w.navigator)
  for (const k of [
    "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "Text", "DocumentFragment", "Event", "MouseEvent",
    "KeyboardEvent", "FocusEvent", "CustomEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "CSSStyleSheet",
    "ShadowRoot", "HTMLStyleElement", "PointerEvent", "TouchEvent",
  ]) {
    if (w[k] !== undefined) define(k, typeof w[k] === "function" && /^[a-z]/.test(k) ? (w[k] as Function).bind(w) : w[k])
  }
  const noopObserver = class { observe() {} unobserve() {} disconnect() {} }
  define("ResizeObserver", noopObserver)
  ;(w as Record<string, unknown>).ResizeObserver = noopObserver
  ;(w as Record<string, unknown>).matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  g.IS_REACT_ACT_ENVIRONMENT = true
  // React reports errors thrown in event handlers through the global reportError.
  define("reportError", (err: unknown) => errorSink(err))
  env = {
    React: nodeRequire("react"),
    ReactDOMClient: nodeRequire("react-dom/client"),
    RNW: nodeRequire("react-native-web"),
    document: w.document as Document,
  }
  return env
}

// ---------------------------------------------------------------- module loader

const PROJECT_PREFIX = "project/"

function createLoader(ws: Workspace, e: Env) {
  const cache = new Map<string, { exports: unknown }>()
  const sdkByPath = new Map(Object.values(SDK_MODULES).map((f) => [path.normalize(f), f]))

  function resolve(from: string, spec: string): string {
    if (spec === "react" || spec === "react/jsx-runtime" || spec === "react/jsx-dev-runtime") return `pkg:${spec}`
    if (spec === "react-native") return "pkg:react-native-web"
    if (SDK_MODULES[spec]) return `sdk:${path.normalize(SDK_MODULES[spec])}`
    if (spec.startsWith("@/")) return projectFile(spec.slice(2), spec)
    if (spec.startsWith(".")) {
      if (from.startsWith("sdk:")) {
        const base = path.normalize(path.resolve(path.dirname(from.slice(4)), spec))
        for (const ext of [".tsx", ".ts"]) if (sdkByPath.has(base + ext)) return `sdk:${base + ext}`
      } else {
        const dir = from.slice(PROJECT_PREFIX.length).split("/").slice(0, -1)
        const parts = [...dir]
        for (const part of spec.split("/")) {
          if (part === "..") parts.pop()
          else if (part !== ".") parts.push(part)
        }
        return projectFile(parts.join("/"), spec)
      }
    }
    throw new Error(`Cannot resolve module "${spec}" from ${from.replace(/^(project\/|sdk:)/, "")}`)
  }

  function projectFile(base: string, spec: string) {
    for (const ext of ["", ".tsx", ".ts", "/index.ts", "/index.tsx"]) if (ws.files[base + ext] !== undefined) return PROJECT_PREFIX + base + ext
    throw new Error(`Cannot resolve module "${spec}"`)
  }

  function load(id: string): unknown {
    const hit = cache.get(id)
    if (hit) return hit.exports
    if (id.startsWith("pkg:")) {
      const name = id.slice(4)
      const mod = name === "react-native-web" ? e.RNW : nodeRequire(name)
      cache.set(id, { exports: mod })
      return mod
    }
    const source = id.startsWith("sdk:") ? readFileSync(id.slice(4), "utf8") : ws.files[id.slice(PROJECT_PREFIX.length)]
    const fileName = id.startsWith("sdk:") ? `sdk/${path.basename(id.slice(4))}` : id
    const { code } = transform(source, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true, filePath: fileName })
    const module = { exports: {} as Record<string, unknown> }
    cache.set(id, module)
    // The sourceURL makes stack frames point at the project file; sucrase keeps line numbers.
    const fn = new Function("require", "module", "exports", `${code}\n//# sourceURL=${fileName}`)
    fn((spec: string) => load(resolve(id, spec)), module, module.exports)
    return module.exports
  }

  return { load, sdk: (spec: string) => load(`sdk:${path.normalize(SDK_MODULES[spec])}`), project: (p: string) => load(PROJECT_PREFIX + p) }
}

/** The project file and line of the first project frame in a stack. new Function adds 2 lines. */
function locateError(err: unknown): { file?: string; line?: number } {
  const stack = err instanceof Error ? (err.stack ?? "") : ""
  const m = /project\/([\w/.-]+\.tsx?):(\d+):\d+/.exec(stack)
  return m ? { file: m[1], line: Math.max(1, Number(m[2]) - 2) } : {}
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------------------------------------------------------------- the gate

export async function renderGate(ws: Workspace): Promise<GateResult> {
  const t0 = performance.now()
  const e = setupDom()
  const { React, ReactDOMClient } = e
  const diagnostics: Diagnostic[] = []

  let loader: ReturnType<typeof createLoader>
  let App: React.ComponentType, THEME: unknown, SEED: Record<string, Record<string, unknown>[]>
  let ThemeProvider: React.ComponentType<any>, DataProvider: React.ComponentType<any>, NavProvider: React.ComponentType<any>
  let DataStore: new (seed: Record<string, Record<string, unknown>[]>) => unknown
  try {
    loader = createLoader(ws, e)
    ;({ ThemeProvider } = loader.sdk("@app/theme") as any)
    ;({ DataProvider, DataStore } = loader.sdk("@app/data-runtime") as any)
    ;({ NavProvider } = loader.sdk("@app/nav-runtime") as any)
    ;({ THEME } = loader.project("theme/index.ts") as any)
    ;({ SEED } = loader.project("data/index.ts") as any)
    App = (loader.project("app/routes.tsx") as any).default
  } catch (err) {
    return { gate: "render", ok: false, ms: performance.now() - t0, diagnostics: [{ gate: "render", code: "module_load", message: `Loading the app failed: ${errText(err)}`, ...locateError(err) }] }
  }

  const consoleError = console.error
  const warnings = new Set<string>()

  async function mount(screen: string, params: Record<string, unknown> | undefined, press?: number) {
    const errors: { err: unknown; componentStack?: string }[] = []
    const logged: string[] = []
    console.error = (...args: unknown[]) => logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
    errorSink = (err) => errors.push({ err })
    const container = e.document.createElement("div")
    e.document.body.appendChild(container)
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError: (err, info) => errors.push({ err, componentStack: info.componentStack }),
      onCaughtError: (err, info) => errors.push({ err, componentStack: info.componentStack }),
    })
    const store = new DataStore(SEED)
    const tree = React.createElement(
      ThemeProvider,
      { theme: THEME },
      React.createElement(DataProvider, { store }, React.createElement(NavProvider, { initial: { screen, params } }, React.createElement(App)))
    )
    let pressedLabel: string | undefined
    let blank = false
    let buttons = 0
    try {
      await React.act(async () => root.render(tree))
      await React.act(() => new Promise((r) => setTimeout(r, 5)))
      const body = container.querySelector('[data-testid="screen-body"]')
      const pressables = body ? [...body.querySelectorAll('[role="button"]')] : []
      buttons = pressables.length
      if (!errors.length && body && !body.textContent?.trim() && !body.querySelector("input, textarea, img")) blank = true
      if (press !== undefined && pressables[press]) {
        const el = pressables[press] as HTMLElement
        pressedLabel = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60)
        await React.act(async () => el.click())
        await React.act(() => new Promise((r) => setTimeout(r, 5)))
      }
    } catch (err) {
      errors.push({ err })
    } finally {
      try {
        await React.act(async () => root.unmount())
      } catch {}
      container.remove()
      console.error = consoleError
      errorSink = () => {}
    }
    for (const l of logged) {
      if (/Maximum update depth|Too many re-renders/.test(l)) errors.push({ err: new Error(l.slice(0, 300)) })
      else if (/unique "key" prop|Each child in a list/.test(l)) warnings.add(`${screen}: list items need a unique "key" prop.`)
    }
    return { errors, blank, buttons, pressedLabel }
  }

  const describe = (screen: string, label: string, r: Awaited<ReturnType<typeof mount>>) => {
    for (const { err, componentStack } of r.errors.slice(0, 1)) {
      const where = locateError(err)
      const comp = componentStack?.trim().split("\n").slice(0, 3).map((s) => s.trim()).join(" < ")
      diagnostics.push({
        gate: "render",
        code: label.startsWith("press") ? "press_error" : "render_error",
        file: where.file ?? `screens/${screen}.tsx`,
        line: where.line,
        message: `Screen "${screen}" ${label}: ${errText(err)}${comp ? `\n  in ${comp}` : ""}`,
      })
    }
    if (r.blank)
      diagnostics.push({ gate: "render", code: "blank_screen", file: `screens/${screen}.tsx`, message: `Screen "${screen}" ${label} rendered nothing visible. Show content, a loading state or an EmptyState.` })
  }

  const firstSeedId = (entity: string) => {
    const row = SEED[entity]?.[0]
    return row ? String(row.id ?? `${entity.toLowerCase()}-1`) : "missing-id"
  }

  for (const [screen, meta] of Object.entries(ws.manifest.screens).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const paramEntries = Object.entries(meta.params ?? {})
    const sample = paramEntries.length
      ? Object.fromEntries(paramEntries.map(([k, t]) => [k, t.startsWith("ref:") ? firstSeedId(t.slice(4)) : t === "number" ? 1 : "sample"]))
      : undefined
    const before = diagnostics.length

    const first = await mount(screen, sample)
    describe(screen, sample ? `with params ${JSON.stringify(sample)}` : "on open", first)

    if (paramEntries.some(([, t]) => t.startsWith("ref:"))) {
      const missing = Object.fromEntries(paramEntries.map(([k, t]) => [k, t.startsWith("ref:") ? "does-not-exist" : sample![k]]))
      describe(screen, `with an id that doesn't exist (${JSON.stringify(missing)})`, await mount(screen, missing))
    }

    if (diagnostics.length === before) {
      for (let i = 0; i < Math.min(first.buttons, MAX_PRESSES_PER_SCREEN); i++) {
        const r = await mount(screen, sample, i)
        if (r.errors.length) {
          describe(screen, `press "${r.pressedLabel ?? `button ${i + 1}`}"`, { ...r, blank: false })
          break
        }
      }
    }
  }

  for (const w of warnings) diagnostics.push({ gate: "render", code: "warning", message: w })
  const blocking = diagnostics.filter((d) => d.code !== "warning")
  return { gate: "render", ok: blocking.length === 0, ms: performance.now() - t0, diagnostics }
}
