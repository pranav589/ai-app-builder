// expo-router for the preview: file-based routes from the generated app/
// folder, a native-style Stack (push, modal, back), Tabs with a tab bar,
// headers, links, params and focus effects. Unknown routes open a proper
// "not built yet" screen instead of crashing.

import * as React from "react"
import * as RN from "react-native-web"

import { config, createStore, handlers, moduleStore, post } from "./bridge"
import { PreviewModuleError, lateModules, requireModule } from "./modules"
import * as native from "./shims/native"
import { useTheme, type Theme } from "./shims/theme"
import { INSETS, InsetsContext, icons } from "./shims/ui"
import { previewIcon } from "@app/shared/app-project/icons"

const Icon = icons.Ionicons

// ---------------------------------------------------------------- routes

type Layout = { file: string; depth: number }
type Route = { file: string; pathname: string; segments: string[]; layouts: Layout[] }

const CODE_EXT = /\.(tsx|ts|jsx|js)$/
const isGroup = (s: string) => /^\(.*\)$/.test(s)
const ROOT_LAYOUT = "__root__"

function layoutFile(modules: Record<string, string>, dir: string) {
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) if (`${dir}/_layout${ext}` in modules) return `${dir}/_layout${ext}`
  return null
}

let routeCache: { version: number; routes: Route[] } = { version: -1, routes: [] }
function routes(): Route[] {
  const { modules, version } = moduleStore.get()
  if (routeCache.version === version) return routeCache.routes
  const out: Route[] = []
  for (const file of Object.keys(modules)) {
    if (!file.startsWith("app/") || !CODE_EXT.test(file)) continue
    const segments = file.slice(4).replace(CODE_EXT, "").split("/")
    const last = segments[segments.length - 1]
    if (last === "_layout" || last.startsWith("+")) continue
    const url = segments.filter((s) => !isGroup(s))
    if (url[url.length - 1] === "index") url.pop()
    const layouts: Layout[] = [{ file: layoutFile(modules, "app") ?? ROOT_LAYOUT, depth: 0 }]
    for (let i = 1; i < segments.length; i++) {
      const f = layoutFile(modules, ["app", ...segments.slice(0, i)].join("/"))
      if (f) layouts.push({ file: f, depth: i })
    }
    out.push({ file, pathname: "/" + url.join("/"), segments, layouts })
  }
  routeCache = { version, routes: out }
  return out
}

function match(pathname: string): { route: Route; params: Record<string, string> } | null {
  const clean = "/" + pathname.split("?")[0].replace(/^\/+|\/+$/g, "")
  const all = routes()
  const exact = all.find((r) => r.pathname === clean)
  if (exact) return { route: exact, params: {} }
  const parts = clean.split("/").filter(Boolean)
  for (const r of all) {
    const rp = r.pathname.split("/").filter(Boolean)
    if (rp.length !== parts.length) continue
    const params: Record<string, string> = {}
    if (rp.every((s, i) => (/^\[.+\]$/.test(s) ? ((params[s.slice(1, -1).replace(/^\.\.\./, "")] = decodeURIComponent(parts[i])), true) : s === parts[i])))
      return { route: r, params }
  }
  return null
}

/** The name a layout's navigator uses for a route (e.g. "(tabs)" or "habit-detail"). */
function childName(route: Route, level: number) {
  const depth = route.layouts[level]?.depth ?? 0
  const next = route.layouts[level + 1]
  if (next) return route.segments[depth]
  const rest = route.segments.slice(depth)
  if (rest[rest.length - 1] === "index" && rest.length > 1) return rest.join("/")
  return rest.join("/")
}

const pretty = (s: string) =>
  s
    .replace(/^\/|\(.*?\)\/?/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Home"

// ---------------------------------------------------------------- navigation state

type Anim = "push" | "fade" | "none"
type Entry = { key: number; pathname: string; params: Record<string, string>; anim: Anim; leaving?: boolean }
type Href = string | { pathname: string; params?: Record<string, unknown> }

let keySeq = 0
function entryFor(href: Href, anim: Anim): Entry {
  let pathname: string
  const params: Record<string, string> = {}
  if (typeof href === "string") {
    const [p, q] = href.split("?")
    pathname = p || "/"
    if (q) new URLSearchParams(q).forEach((v, k) => (params[k] = v))
  } else {
    pathname = href.pathname || "/"
    for (const [k, v] of Object.entries(href.params ?? {})) if (v != null) params[k] = String(v)
  }
  // Fill dynamic segments like /habit/[id].
  pathname = pathname.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (_, k) => {
    const v = params[k] ?? ""
    delete params[k]
    return encodeURIComponent(v)
  })
  if (!pathname.startsWith("/")) pathname = "/" + pathname
  const m = match(pathname)
  return { key: ++keySeq, pathname, params: { ...(m?.params ?? {}), ...params }, anim }
}

const nav = createStore<{ stack: Entry[] }>({ stack: [entryFor(config.route, "none")] })
const tabLayouts = new Set<string>()
const live = () => nav.get().stack.filter((e) => !e.leaving)

/** Both routes sit under the same Tabs navigator: moving between them switches tab. */
function sameTabs(a: string, b: string) {
  const ra = match(a)?.route
  const rb = match(b)?.route
  if (!ra || !rb) return false
  return ra.layouts.some((l) => tabLayouts.has(l.file) && rb.layouts.some((m) => m.file === l.file))
}

function setStack(stack: Entry[]) {
  nav.set({ stack })
}

const LEAVE_MS = 320

export const router = {
  push(href: Href) {
    const next = entryFor(href, "push")
    const stack = live()
    const top = stack[stack.length - 1]
    if (top && top.pathname === next.pathname && JSON.stringify(top.params) === JSON.stringify(next.params)) return
    if (top && sameTabs(top.pathname, next.pathname)) return setStack([...stack.slice(0, -1), { ...next, anim: "none" }])
    setStack([...stack, next])
  },
  navigate(href: Href) {
    const next = entryFor(href, "push")
    const stack = live()
    const i = stack.findIndex((e) => e.pathname === next.pathname)
    if (i !== -1 && i < stack.length - 1) {
      for (const e of stack.slice(i + 1)) router.back()
      return
    }
    router.push(href)
  },
  replace(href: Href) {
    const stack = live()
    const top = stack[stack.length - 1]
    const next = entryFor(href, top && sameTabs(top.pathname, typeof href === "string" ? href : href.pathname) ? "none" : "fade")
    setStack([...stack.slice(0, -1), next])
  },
  back() {
    const stack = live()
    if (stack.length <= 1) return
    const leaving = stack[stack.length - 1]
    setStack(nav.get().stack.map((e) => (e.key === leaving.key ? { ...e, leaving: true } : e)))
    setTimeout(() => setStack(nav.get().stack.filter((e) => e.key !== leaving.key)), LEAVE_MS)
  },
  canGoBack: () => live().length > 1,
  dismiss: () => router.back(),
  dismissAll() {
    const stack = live()
    if (stack.length > 1) setStack([stack[0]])
  },
  canDismiss: () => live().length > 1,
  dismissTo: (href: Href) => router.navigate(href),
  setParams(params: Record<string, unknown>) {
    const stack = nav.get().stack
    const top = stack.filter((e) => !e.leaving).pop()
    if (!top) return
    setStack(stack.map((e) => (e.key === top.key ? { ...e, params: { ...e.params, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) } } : e)))
  },
}

handlers.reset = (route) => setStack([entryFor(route, "fade")])

// Tell the host which screen is showing (for its labels).
let lastReported = ""
nav.subscribe(() => {
  const top = live().pop()
  if (top && top.pathname !== lastReported) {
    lastReported = top.pathname
    post({ kind: "route", pathname: top.pathname })
  }
})

// ---------------------------------------------------------------- contexts

type ScreenOptions = Record<string, unknown>
const EntryContext = React.createContext<{ entry: Entry; isTop: boolean; index: number } | null>(null)
const LevelContext = React.createContext(0)
const OptionsContext = React.createContext<(o: ScreenOptions) => void>(() => {})

const useEntry = () => React.useContext(EntryContext)

function loadDefault(file: string): React.ComponentType {
  const mod = requireModule("./" + file, "") as { default?: React.ComponentType }
  if (typeof mod?.default !== "function" && typeof mod?.default !== "object")
    throw new PreviewModuleError(`${file} must export a component as its default export.`, file)
  return mod.default as React.ComponentType
}

// ---------------------------------------------------------------- fallback screens

function Notice({ icon, title, body, action }: { icon: string; title: string; body: string; action?: { label: string; onPress: () => void } }) {
  const t = useTheme()
  return (
    <RN.View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, paddingBottom: 60, backgroundColor: t.colors.background }}>
      <RN.View style={{ width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.primarySoft, marginBottom: 20 }}>
        <Icon name={icon} size={28} color={t.colors.primary} />
      </RN.View>
      <RN.Text style={{ fontSize: 22, fontWeight: "600", color: t.colors.text, textAlign: "center", letterSpacing: -0.3 }}>{title}</RN.Text>
      <RN.Text style={{ marginTop: 8, fontSize: 15, lineHeight: 22, color: t.colors.textMuted, textAlign: "center" }}>{body}</RN.Text>
      {action && (
        <RN.Pressable
          onPress={action.onPress}
          style={({ pressed }: { pressed: boolean }) => ({ marginTop: 28, height: 48, paddingHorizontal: 28, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.primary, opacity: pressed ? 0.75 : 1 })}
        >
          <RN.Text style={{ color: t.colors.onPrimary, fontSize: 16, fontWeight: "600" }}>{action.label}</RN.Text>
        </RN.Pressable>
      )}
    </RN.View>
  )
}

function UnknownRoute({ pathname }: { pathname: string }) {
  const planned = moduleStore.get().planned.find((p) => p.pathname === pathname)
  const canBack = router.canGoBack()
  const action = { label: canBack ? "Go back" : "Back to start", onPress: () => (canBack ? router.back() : router.replace(config.route)) }
  if (planned && planned.state !== "ready" && planned.state !== "error") {
    return <Notice icon="hourglass-outline" title={planned.state === "generating" ? `Building ${planned.name}` : `${planned.name} is up next`} body="This screen is still being built. It opens here as soon as it's ready." action={action} />
  }
  if (planned?.state === "error") return <Notice icon="alert-circle-outline" title={`${planned.name} didn't build`} body="Ask the agent in chat to retry it." action={action} />
  return <Notice icon="construct-outline" title="This screen isn't built yet" body={`"${pretty(pathname)}" isn't part of this app yet. Ask the agent in chat to add it, and it will open from here.`} action={action} />
}

/** The project file a crash came from: from the stack, else the screen being shown. */
function crashFile(error: Error, fallback?: string) {
  if (error instanceof PreviewModuleError && error.file) return error.file
  const m = /project:\/\/\/([^\s:)]+\.(?:tsx|ts|jsx|js))/.exec(error.stack ?? "")
  return m?.[1] ?? fallback
}

export class ErrorBoundary extends React.Component<{ children?: React.ReactNode; resetKey?: unknown; file?: string }, { error: Error | null; key?: unknown }> {
  state: { error: Error | null; key?: unknown } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: Error | null; key?: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }
  componentDidCatch(error: Error) {
    post({ kind: "error", message: error.message, file: crashFile(error, this.props.file) })
  }
  render() {
    if (!this.state.error) return this.props.children
    return <ErrorScreen error={this.state.error} onRetry={() => this.setState({ error: null })} />
  }
}

function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useTheme()
  return (
    <RN.View style={{ flex: 1, paddingTop: INSETS.top + 24, paddingHorizontal: 24, backgroundColor: t.colors.background }}>
      <RN.View style={{ padding: 18, borderRadius: 16, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border }}>
        <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="bug-outline" size={20} color={t.colors.danger} />
          <RN.Text style={{ fontSize: 17, fontWeight: "600", color: t.colors.text }}>This screen hit an error</RN.Text>
        </RN.View>
        <RN.Text style={{ marginTop: 10, fontSize: 13, lineHeight: 19, color: t.colors.textMuted, fontFamily: "ui-monospace, Menlo, monospace" }}>{error.message}</RN.Text>
        <RN.Pressable onPress={onRetry} style={{ marginTop: 14, alignSelf: "flex-start" }}>
          <RN.Text style={{ color: t.colors.primary, fontSize: 15, fontWeight: "600" }}>Try again</RN.Text>
        </RN.Pressable>
      </RN.View>
    </RN.View>
  )
}

// ---------------------------------------------------------------- rendering

/** Renders what sits below layout `level` for an entry: the next layout or the screen. */
function renderBelow(route: Route, level: number, entry: Entry): React.ReactNode {
  const next = route.layouts[level]
  if (next) {
    const Layout = next.file === ROOT_LAYOUT ? DefaultRoot : loadDefault(next.file)
    return (
      <LevelContext.Provider value={level}>
        <Layout />
      </LevelContext.Provider>
    )
  }
  const Screen = loadDefault(route.file)
  return <Screen key={entry.key} />
}

function DefaultRoot() {
  return <Stack />
}

function resolveOptions(o: unknown, name: string): ScreenOptions {
  if (typeof o === "function") return (o as (a: unknown) => ScreenOptions)({ route: { name, params: {} }, navigation: navigationApi() }) ?? {}
  return (o as ScreenOptions) ?? {}
}

function collectChildOptions(children: React.ReactNode, ScreenType: unknown) {
  const map: Record<string, ScreenOptions> = {}
  const order: string[] = []
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c) || c.type !== ScreenType) return
    const p = c.props as { name?: string; options?: unknown }
    if (!p.name) return
    order.push(p.name)
    map[p.name] = resolveOptions(p.options, p.name)
  })
  return { map, order }
}

function useNav() {
  return React.useSyncExternalStore(nav.subscribe, nav.get)
}

function useModulesVersion() {
  return React.useSyncExternalStore(moduleStore.subscribe, () => moduleStore.get().version)
}

const textOf = (v: unknown, props: Record<string, unknown>) => (typeof v === "function" ? (v as (p: unknown) => React.ReactNode)(props) : (v as React.ReactNode))

function Header({ opts, name, canGoBack, tabs }: { opts: ScreenOptions; name: string; canGoBack: boolean; tabs?: boolean }) {
  const t = useTheme()
  const style = (opts.headerStyle as { backgroundColor?: string } | undefined) ?? {}
  const tint = (opts.headerTintColor as string) ?? t.colors.primary
  const transparent = !!opts.headerTransparent
  const title = (opts.headerTitle ?? opts.title ?? pretty(name)) as unknown
  const large = !!opts.headerLargeTitle
  const left =
    opts.headerLeft !== undefined
      ? textOf(opts.headerLeft, { tintColor: tint, canGoBack })
      : canGoBack && !tabs && opts.headerBackVisible !== false
        ? (
            <RN.Pressable onPress={() => router.back()} hitSlop={10} style={{ flexDirection: "row", alignItems: "center", marginLeft: -6 }}>
              <Icon name="chevron-back" size={28} color={tint} />
              {config.platform === "ios" && <RN.Text style={{ color: tint, fontSize: 17 }}>{(opts.headerBackTitle as string) ?? "Back"}</RN.Text>}
            </RN.Pressable>
          )
        : null
  const right = opts.headerRight !== undefined ? textOf(opts.headerRight, { tintColor: tint, canGoBack }) : null
  const titleNode =
    typeof title === "function" ? (
      textOf(title, { children: String(opts.title ?? pretty(name)), tintColor: tint })
    ) : (
      <RN.Text numberOfLines={1} style={[{ fontSize: 17, fontWeight: "600", color: (opts.headerTitleStyle as { color?: string })?.color ?? t.colors.text }, opts.headerTitleStyle as object]}>
        {String(title)}
      </RN.Text>
    )
  return (
    <RN.View
      style={[
        { paddingTop: INSETS.top, backgroundColor: transparent ? "transparent" : (style.backgroundColor ?? t.colors.background), zIndex: 10 },
        opts.headerShadowVisible !== false && !transparent ? { borderBottomWidth: RN.StyleSheet.hairlineWidth, borderBottomColor: t.colors.border } : null,
        transparent ? { position: "absolute", top: 0, left: 0, right: 0 } : null,
      ]}
    >
      <RN.View style={{ height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 }}>
        <RN.View style={{ flex: 1, alignItems: "flex-start" }}>{left}</RN.View>
        {!large && <RN.View style={{ flex: 2, alignItems: config.platform === "ios" || opts.headerTitleAlign === "center" ? "center" : "flex-start" }}>{titleNode}</RN.View>}
        <RN.View style={{ flex: 1, alignItems: "flex-end" }}>{right}</RN.View>
      </RN.View>
      {large && (
        <RN.Text style={{ fontSize: 34, fontWeight: "700", letterSpacing: -0.5, color: t.colors.text, paddingHorizontal: 16, paddingBottom: 8 }}>{String(opts.title ?? pretty(name))}</RN.Text>
      )}
    </RN.View>
  )
}

const MODAL = new Set(["modal", "formSheet", "fullScreenModal", "transparentModal", "containedModal", "containedTransparentModal", "pageSheet"])

function StackLayer({ entry, index, isTop, level, screenOptions, childOptions, theme }: { entry: Entry; index: number; isTop: boolean; level: number; screenOptions: unknown; childOptions: Record<string, ScreenOptions>; theme: Theme }) {
  const [dynamic, setDynamic] = React.useState<ScreenOptions>({})
  const setOptions = React.useCallback((o: ScreenOptions) => setDynamic((d) => ({ ...d, ...o })), [])
  const m = match(entry.pathname)
  const name = m ? childName(m.route, level) : entry.pathname
  const opts: ScreenOptions = { ...resolveOptions(screenOptions, name), ...(childOptions[name] ?? {}), ...dynamic }
  const deeper = !!m && m.route.layouts.length > level + 1
  // Groups (like tabs) bring their own chrome unless asked otherwise.
  const showHeader = m ? (deeper ? opts.headerShown === true : opts.headerShown !== false) : false
  const modal = MODAL.has(String(opts.presentation))
  // iOS page sheet: below the status bar, rounded top, the screen behind dimmed.
  const sheet = modal && !["fullScreenModal", "transparentModal", "containedTransparentModal"].includes(String(opts.presentation))
  const cls = entry.leaving
    ? modal
      ? "pv-layer pv-modal-out"
      : "pv-layer pv-out"
    : index === 0 || entry.anim === "none"
      ? "pv-layer"
      : entry.anim === "fade" || opts.animation === "fade"
        ? "pv-layer pv-fade"
        : modal || opts.animation === "slide_from_bottom"
          ? "pv-layer pv-modal"
          : "pv-layer pv-push"
  const bg = opts.presentation === "transparentModal" ? "transparent" : ((opts.contentStyle as { backgroundColor?: string })?.backgroundColor ?? theme.colors.background)

  const content = (
    <EntryContext.Provider value={{ entry, isTop: isTop && !entry.leaving, index }}>
      <OptionsContext.Provider value={setOptions}>
        <InsetsContext.Provider value={sheet ? { ...INSETS, top: 0 } : INSETS}>
          {showHeader && <Header opts={opts} name={name} canGoBack={index > 0 && !sheet} />}
          <RN.View style={{ flex: 1 }} testID="pv-screen-body">
            <ErrorBoundary resetKey={moduleStore.get().version} file={m?.route.file}>{m ? renderBelow(m.route, level + 1, entry) : <UnknownRoute pathname={entry.pathname} />}</ErrorBoundary>
          </RN.View>
        </InsetsContext.Provider>
      </OptionsContext.Provider>
    </EntryContext.Provider>
  )
  return React.createElement(
    "div",
    { className: sheet ? `${cls} pv-sheet` : cls, style: { zIndex: index + 1, background: bg }, "aria-hidden": !isTop || undefined },
    content
  )
}

function StackScreen({ options }: { name?: string; options?: unknown }) {
  // Rendered inside a screen: sets that screen's options.
  const set = React.useContext(OptionsContext)
  const resolved = typeof options === "function" ? undefined : options
  React.useLayoutEffect(() => {
    if (resolved) set(resolved as ScreenOptions)
  }, [set, JSON.stringify(resolved ?? {}, (_k, v) => (typeof v === "function" ? String(v).length : v))]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export function Stack({ screenOptions, children }: { screenOptions?: unknown; children?: React.ReactNode; initialRouteName?: string }) {
  const level = React.useContext(LevelContext)
  const parent = useEntry()
  const { stack } = useNav()
  useModulesVersion()
  const theme = useTheme()
  const { map } = collectChildOptions(children, StackScreen)

  // A Stack nested inside another navigator just shows the current screen.
  if (parent) {
    const m = match(parent.entry.pathname)
    return m ? <>{renderBelow(m.route, level + 1, parent.entry)}</> : <UnknownRoute pathname={parent.entry.pathname} />
  }
  const alive = stack.filter((e) => !e.leaving)
  const topKey = alive[alive.length - 1]?.key
  return React.createElement(
    "div",
    { className: "pv-stack" },
    stack.map((e, i) => (
      <StackLayer key={e.key} entry={e} index={i} isTop={e.key === topKey} level={level} screenOptions={screenOptions} childOptions={map} theme={theme} />
    ))
  )
}
Stack.Screen = StackScreen
Stack.Protected = ({ guard, children }: { guard?: boolean; children?: React.ReactNode }) => (guard === false ? null : <>{children}</>)

function TabsScreen(props: { name?: string; options?: unknown }) {
  return <StackScreen {...props} />
}

export function Tabs({ screenOptions, children }: { screenOptions?: unknown; children?: React.ReactNode; tabBar?: unknown }) {
  const level = React.useContext(LevelContext)
  const ctx = useEntry()
  useModulesVersion()
  const t = useTheme()
  const [dynamic, setDynamic] = React.useState<ScreenOptions>({})
  const setOptions = React.useCallback((o: ScreenOptions) => setDynamic((d) => ({ ...d, ...o })), [])
  const m = ctx ? match(ctx.entry.pathname) : null
  const myLayout = m?.route.layouts[level]?.file
  if (myLayout) tabLayouts.add(myLayout)
  if (!ctx || !m || !myLayout) return null

  const siblings = routes().filter((r) => r.layouts[level]?.file === myLayout)
  const { map, order } = collectChildOptions(children, TabsScreen)
  const names = order.length ? order : siblings.map((r) => childName(r, level))
  const tabs = names
    .map((n) => ({ name: n, route: siblings.find((r) => childName(r, level) === n || childName(r, level) === `${n}/index`), opts: { ...resolveOptions(screenOptions, n), ...(map[n] ?? {}) } }))
    .filter((x) => x.route && x.opts.href !== null)
  const activeName = childName(m.route, level)
  const active = { ...resolveOptions(screenOptions, activeName), ...(map[activeName] ?? {}), ...dynamic }
  const activeTint = (active.tabBarActiveTintColor as string) ?? t.colors.primary
  const inactiveTint = (active.tabBarInactiveTintColor as string) ?? t.colors.textMuted
  const barStyle = active.tabBarStyle as { display?: string } | undefined
  const showLabel = active.tabBarShowLabel !== false

  return (
    <RN.View style={{ flex: 1 }}>
      <OptionsContext.Provider value={setOptions}>
        {active.headerShown !== false && <Header opts={active} name={activeName} canGoBack={false} tabs />}
        <RN.View style={{ flex: 1 }} testID="pv-screen-body">
          <ErrorBoundary resetKey={`${ctx.entry.pathname}:${moduleStore.get().version}`} file={m.route.file}>{renderBelow(m.route, level + 1, ctx.entry)}</ErrorBoundary>
        </RN.View>
      </OptionsContext.Provider>
      {barStyle?.display !== "none" && tabs.length > 0 && (
        <RN.View
          style={[
            { flexDirection: "row", backgroundColor: t.colors.surface, borderTopWidth: RN.StyleSheet.hairlineWidth, borderTopColor: t.colors.border, paddingBottom: INSETS.bottom, height: 49 + INSETS.bottom },
            active.tabBarStyle as object,
          ]}
        >
          {tabs.map((tab) => {
            const focused = tab.route!.file === m.route.file
            const color = focused ? activeTint : inactiveTint
            const label = (tab.opts.tabBarLabel ?? tab.opts.title ?? pretty(tab.name)) as unknown
            const badge = tab.opts.tabBarBadge as string | number | undefined
            return (
              <RN.Pressable
                key={tab.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  void native.Haptics.selectionAsync()
                  router.push(tab.route!.pathname)
                }}
                style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 6, gap: 2 }}
              >
                <RN.View>
                  {typeof tab.opts.tabBarIcon === "function" ? (
                    (tab.opts.tabBarIcon as (p: { focused: boolean; color: string; size: number }) => React.ReactNode)({ focused, color, size: 24 })
                  ) : (
                    <Icon name={focused ? "ellipse" : "ellipse-outline"} size={22} color={color} />
                  )}
                  {badge != null && (
                    <RN.View style={{ position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: t.colors.danger, alignItems: "center", justifyContent: "center" }}>
                      <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{String(badge)}</RN.Text>
                    </RN.View>
                  )}
                </RN.View>
                {showLabel && (typeof label === "function" ? textOf(label, { focused, color }) : <RN.Text style={[{ fontSize: 10, fontWeight: "500", color }, active.tabBarLabelStyle as object]}>{String(label)}</RN.Text>)}
              </RN.Pressable>
            )
          })}
        </RN.View>
      )}
    </RN.View>
  )
}
Tabs.Screen = TabsScreen

// ---------------------------------------------------------------- native tabs

type TriggerSpec = { name: string; label?: string; icon?: { sf?: string | { default?: string; selected?: string }; md?: string }; badge?: string; hidden?: boolean }

const TriggerLabel = (_p: { children?: React.ReactNode; hidden?: boolean }) => null
const TriggerIcon = (_p: { sf?: unknown; md?: string; src?: unknown; drawable?: string }) => null
const TriggerBadge = (_p: { children?: React.ReactNode; hidden?: boolean }) => null
const TriggerVectorIcon = (_p: { family?: unknown; name?: string }) => null
function NativeTabsTrigger(_p: { name: string; hidden?: boolean; children?: React.ReactNode }) {
  return null
}
NativeTabsTrigger.Label = TriggerLabel
NativeTabsTrigger.Icon = TriggerIcon
NativeTabsTrigger.Badge = TriggerBadge
NativeTabsTrigger.VectorIcon = TriggerVectorIcon

const textContent = (n: React.ReactNode): string =>
  typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(textContent).join("") : ""

function readTriggers(children: React.ReactNode): TriggerSpec[] {
  const out: TriggerSpec[] = []
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c) || c.type !== NativeTabsTrigger) return
    const p = c.props as { name: string; hidden?: boolean; children?: React.ReactNode }
    const spec: TriggerSpec = { name: p.name, hidden: p.hidden }
    React.Children.forEach(p.children, (part) => {
      if (!React.isValidElement(part)) return
      const pp = part.props as Record<string, unknown>
      if (part.type === TriggerLabel && !pp.hidden) spec.label = textContent(pp.children as React.ReactNode)
      if (part.type === TriggerIcon) spec.icon = { sf: pp.sf as NonNullable<TriggerSpec["icon"]>["sf"], md: pp.md as string }
      if (part.type === TriggerVectorIcon) spec.icon = { md: pp.name as string }
      if (part.type === TriggerBadge && !pp.hidden) spec.badge = textContent(pp.children as React.ReactNode) || " "
    })
    out.push(spec)
  })
  return out
}

function nativeIconName(icon: TriggerSpec["icon"], focused: boolean): string {
  if (!icon) return focused ? "ellipse" : "ellipse-outline"
  const sf = typeof icon.sf === "string" ? icon.sf : focused ? (icon.sf?.selected ?? icon.sf?.default) : icon.sf?.default
  return previewIcon({ sf, md: icon.md }, focused) ?? previewIcon({ md: icon.md }, focused) ?? (focused ? "ellipse" : "ellipse-outline")
}

/** expo-router/native-tabs: the platform tab bar (UITabBarController / Material bottom navigation). */
export function NativeTabs({
  children,
  tintColor,
  backgroundColor,
  iconColor,
  labelStyle,
  badgeBackgroundColor,
  labelVisibilityMode,
}: {
  children?: React.ReactNode
  tintColor?: string
  backgroundColor?: string
  iconColor?: string | { default?: string; selected?: string }
  labelStyle?: { color?: string; default?: { color?: string }; selected?: { color?: string } }
  badgeBackgroundColor?: string
  labelVisibilityMode?: string
  [k: string]: unknown
}) {
  const level = React.useContext(LevelContext)
  const ctx = useEntry()
  useModulesVersion()
  const t = useTheme()
  const m = ctx ? match(ctx.entry.pathname) : null
  const myLayout = m?.route.layouts[level]?.file
  if (myLayout) tabLayouts.add(myLayout)
  if (!ctx || !m || !myLayout) return null

  const siblings = routes().filter((r) => r.layouts[level]?.file === myLayout)
  const declared = readTriggers(children)
  const specs = declared.length ? declared : siblings.map((r) => ({ name: childName(r, level) }) as TriggerSpec)
  const tabs = specs
    .filter((s) => !s.hidden)
    .map((s) => ({ spec: s, route: siblings.find((r) => childName(r, level) === s.name || childName(r, level) === `${s.name}/index`) }))
    .filter((x) => x.route)
  const ios = config.platform === "ios"
  const selectedColor = (typeof iconColor === "object" ? iconColor.selected : undefined) ?? tintColor ?? labelStyle?.selected?.color ?? t.colors.primary
  const idleColor = (typeof iconColor === "object" ? iconColor.default : iconColor) ?? labelStyle?.default?.color ?? labelStyle?.color ?? t.colors.textMuted

  const bar = (
    <RN.View
      style={
        ios
          ? { flexDirection: "row", marginHorizontal: 20, height: 62, borderRadius: 31, paddingHorizontal: 6, alignItems: "center", overflow: "hidden" }
          : { flexDirection: "row", height: 80, alignItems: "center", backgroundColor: backgroundColor ?? t.colors.surface }
      }
    >
      {ios &&
        React.createElement("div", {
          "aria-hidden": true,
          style: {
            position: "absolute",
            inset: 0,
            borderRadius: 31,
            background: backgroundColor ?? (t.dark ? "rgba(40,40,44,0.72)" : "rgba(255,255,255,0.72)"),
            backdropFilter: "blur(24px) saturate(1.8)",
            WebkitBackdropFilter: "blur(24px) saturate(1.8)",
            boxShadow: t.dark ? "0 8px 28px rgba(0,0,0,.5), inset 0 0 0 0.5px rgba(255,255,255,.12)" : "0 8px 28px rgba(16,24,40,.14), inset 0 0 0 0.5px rgba(0,0,0,.06)",
          },
        })}
      {tabs.map(({ spec, route }) => {
        const focused = route!.file === m.route.file
        const color = focused ? selectedColor : idleColor
        return (
          <RN.Pressable
            key={spec.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              void native.Haptics.selectionAsync()
              router.push(route!.pathname)
            }}
            style={{ flex: 1, height: ios ? 52 : 64, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 26 }}
          >
            <RN.View
              style={
                !ios && focused
                  ? { paddingHorizontal: 18, paddingVertical: 4, borderRadius: 16, backgroundColor: t.colors.primarySoft }
                  : ios && focused
                    ? { paddingHorizontal: 18, paddingVertical: 2, borderRadius: 18, backgroundColor: t.dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)" }
                    : { paddingHorizontal: 18, paddingVertical: ios ? 2 : 4 }
              }
            >
              <Icon name={nativeIconName(spec.icon, focused)} size={ios ? 24 : 24} color={color} />
              {spec.badge && (
                <RN.View style={{ position: "absolute", top: -2, right: 8, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: badgeBackgroundColor ?? t.colors.danger, alignItems: "center", justifyContent: "center" }}>
                  <RN.Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{spec.badge.trim()}</RN.Text>
                </RN.View>
              )}
            </RN.View>
            {labelVisibilityMode !== "unlabeled" && (
              <RN.Text style={{ fontSize: ios ? 10 : 12, fontWeight: focused ? "600" : "500", color }}>{spec.label ?? pretty(spec.name)}</RN.Text>
            )}
          </RN.Pressable>
        )
      })}
    </RN.View>
  )

  return (
    <RN.View style={{ flex: 1 }}>
      <RN.View style={{ flex: 1 }} testID="pv-screen-body">
        <ErrorBoundary resetKey={`${ctx.entry.pathname}:${moduleStore.get().version}`} file={m.route.file}>
          {renderBelow(m.route, level + 1, ctx.entry)}
        </ErrorBoundary>
      </RN.View>
      <RN.View style={{ paddingBottom: ios ? INSETS.bottom - 8 : INSETS.bottom - 14, paddingTop: ios ? 6 : 0, backgroundColor: ios ? "transparent" : (backgroundColor ?? t.colors.surface) }}>{bar}</RN.View>
    </RN.View>
  )
}
NativeTabs.Trigger = NativeTabsTrigger

export function Slot() {
  const level = React.useContext(LevelContext)
  const ctx = useEntry()
  const m = ctx ? match(ctx.entry.pathname) : null
  if (!ctx) return <Stack />
  return m ? <>{renderBelow(m.route, level + 1, ctx.entry)}</> : <UnknownRoute pathname={ctx.entry.pathname} />
}

export function Redirect({ href }: { href: Href }) {
  React.useEffect(() => {
    router.replace(href)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export function Link({ href, asChild, replace, push: _push, children, onPress, ...rest }: { href: Href; asChild?: boolean; replace?: boolean; push?: boolean; children?: React.ReactNode; onPress?: (e: unknown) => void; [k: string]: unknown }) {
  const go = (e: unknown) => {
    onPress?.(e)
    if (replace) router.replace(href)
    else router.push(href)
  }
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onPress?: (e: unknown) => void }>
    return React.cloneElement(child, {
      onPress: (e: unknown) => {
        child.props.onPress?.(e)
        go(e)
      },
    })
  }
  return (
    <RN.Text {...rest} onPress={go} accessibilityRole="link">
      {children}
    </RN.Text>
  )
}

// ---------------------------------------------------------------- hooks

function navigationApi() {
  return {
    navigate: (name: string, params?: Record<string, unknown>) => router.push({ pathname: name.startsWith("/") ? name : `/${name}`, params }),
    push: (name: string, params?: Record<string, unknown>) => router.push({ pathname: name.startsWith("/") ? name : `/${name}`, params }),
    goBack: () => router.back(),
    canGoBack: () => router.canGoBack(),
    setParams: router.setParams,
    addListener: () => () => {},
    removeListener: () => {},
    dispatch: () => {},
    getParent: () => undefined,
    getState: () => ({ routes: live().map((e) => ({ key: String(e.key), name: e.pathname, params: e.params })) }),
  }
}

export const useRouter = () => router
export function useLocalSearchParams<T = Record<string, string>>(): T {
  return (useEntry()?.entry.params ?? {}) as T
}
export const useGlobalSearchParams = useLocalSearchParams
export function usePathname() {
  return useEntry()?.entry.pathname ?? config.route
}
export function useSegments() {
  const p = usePathname()
  return match(p)?.route.segments ?? []
}
export function useNavigation() {
  const set = React.useContext(OptionsContext)
  const ctx = useEntry()
  return React.useMemo(() => ({ ...navigationApi(), setOptions: set, isFocused: () => !!ctx?.isTop }), [set, ctx?.isTop])
}
export function useFocusEffect(effect: () => void | (() => void)) {
  const isTop = !!useEntry()?.isTop
  React.useEffect(() => {
    if (isTop) return effect()
  }, [isTop, effect])
}
export const useIsFocused = () => !!useEntry()?.isTop
export const useRootNavigationState = () => ({ key: "root", routes: [] })
export const useNavigationContainerRef = () => ({ current: null, isReady: () => true })

// ---------------------------------------------------------------- root

export function RouterRoot() {
  const version = useModulesVersion()
  useNav()
  const t = useTheme()
  if (version === 0) return <RN.View style={{ flex: 1, backgroundColor: t.colors.background }} />
  const root = routes()[0]?.layouts[0]?.file ?? ROOT_LAYOUT
  let Layout: React.ComponentType = DefaultRoot
  try {
    if (root !== ROOT_LAYOUT) Layout = loadDefault(root)
  } catch (e) {
    return <ErrorScreen error={e as Error} onRetry={() => moduleStore.set({ ...moduleStore.get(), version: moduleStore.get().version + 1 })} />
  }
  return (
    <ErrorBoundary resetKey={version} file={root === ROOT_LAYOUT ? undefined : root}>
      <RN.View style={{ flex: 1, backgroundColor: t.colors.background }}>
        <LevelContext.Provider value={0}>
          <Layout />
        </LevelContext.Provider>
      </RN.View>
    </ErrorBoundary>
  )
}

// Navigation themes some layouts wrap the app in (expo-router re-exports them).
const navTheme = (dark: boolean) => ({
  dark,
  colors: { primary: "#0a84ff", background: dark ? "#000" : "#f2f2f7", card: dark ? "#121212" : "#fff", text: dark ? "#fff" : "#000", border: dark ? "#272729" : "#d8d8d8", notification: "#ff3b30" },
  fonts: {},
})
const NavThemeProvider = ({ children }: { children?: React.ReactNode; value?: unknown }) => <>{children}</>

lateModules["expo-router/native-tabs"] = { __esModule: true, NativeTabs, default: NativeTabs }
lateModules["expo-router/unstable-native-tabs"] = lateModules["expo-router/native-tabs"]

lateModules["expo-router"] = {
  ThemeProvider: NavThemeProvider,
  DarkTheme: navTheme(true),
  DefaultTheme: navTheme(false),
  __esModule: true,
  router,
  useRouter,
  useLocalSearchParams,
  useGlobalSearchParams,
  usePathname,
  useSegments,
  useNavigation,
  useFocusEffect,
  useIsFocused,
  useRootNavigationState,
  useNavigationContainerRef,
  Stack,
  Tabs,
  Slot,
  Redirect,
  Link,
  ErrorBoundary,
  SplashScreen: native.SplashScreen,
  default: router,
}
