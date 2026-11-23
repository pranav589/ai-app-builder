// A tiny CommonJS loader for the generated project. The host compiles every
// file with Sucrase (TypeScript + JSX -> CommonJS) and sends the result;
// this resolves imports between project files and maps packages to
// react-native-web and the preview's stand-ins for Expo native modules.

import * as React from "react"
import * as ReactDOM from "react-dom"
import * as RNW from "react-native-web"
import * as GestureHandler from "react-native-gesture-handler"
import * as Reanimated from "react-native-reanimated"
import * as Worklets from "react-native-worklets"
import * as Zustand from "zustand"
import * as ZustandMiddleware from "zustand/middleware"
import * as ReactQuery from "@tanstack/react-query"
import Axios from "axios"

import { isPlatformOwned } from "@app/shared/verify/ownership"
import { dataStore, moduleStore } from "./bridge"
import * as api from "./shims/api"
import * as backend from "./shims/backend"
import * as native from "./shims/native"
import * as theme from "./shims/theme"
import * as ui from "./shims/ui"
// Filled in by the router module (it needs the loader, so it registers itself).
export const lateModules: Record<string, unknown> = {}

const reactNative = {
  ...RNW,
  Alert: native.Alert,
  ActionSheetIOS: native.ActionSheetIOS,
  Share: native.Share,
  Linking: native.Linking,
  Vibration: native.Vibration,
  Platform: native.Platform,
  SafeAreaView: ui.SafeAreaView,
  StatusBar: Object.assign(() => null, { setBarStyle() {}, setBackgroundColor() {}, setHidden() {}, currentHeight: 0 }),
}

const withDefault = <T extends object>(m: T, def: unknown = m) => ({ __esModule: true, ...m, default: def })

const PACKAGES: Record<string, () => unknown> = {
  react: () => withDefault(React, React),
  "react-dom": () => withDefault(ReactDOM, ReactDOM),
  "react-native": () => withDefault(reactNative, reactNative),
  "react-native-web": () => withDefault(reactNative, reactNative),
  "expo-router": () => lateModules["expo-router"],
  "expo-router/native-tabs": () => lateModules["expo-router/native-tabs"],
  "expo-router/unstable-native-tabs": () => lateModules["expo-router/unstable-native-tabs"],
  "expo-symbols": () => withDefault({ SymbolView: ui.SymbolView }),
  "expo-glass-effect": () => withDefault({ GlassView: ui.GlassView, GlassContainer: ui.GlassContainer, isLiquidGlassAvailable: () => true, isGlassEffectAPIAvailable: () => true }),
  "expo-status-bar": () => withDefault({ StatusBar: ui.StatusBar, setStatusBarStyle() {}, setStatusBarHidden() {} }),
  "react-native-safe-area-context": () => withDefault(ui.safeArea),
  "@expo/vector-icons": () => withDefault(ui.icons),
  "@expo/vector-icons/Ionicons": () => withDefault({}, ui.icons.Ionicons),
  "@expo/vector-icons/MaterialIcons": () => withDefault({}, ui.icons.MaterialIcons),
  "@expo/vector-icons/MaterialCommunityIcons": () => withDefault({}, ui.icons.MaterialCommunityIcons),
  "@expo/vector-icons/Feather": () => withDefault({}, ui.icons.Feather),
  "expo-linear-gradient": () => withDefault({ LinearGradient: ui.LinearGradient }),
  "expo-blur": () => withDefault({ BlurView: ui.BlurView }),
  "expo-image": () => withDefault({ Image: ui.ExpoImage }, ui.ExpoImage),
  "expo-haptics": () => withDefault(native.Haptics),
  "expo-image-picker": () => withDefault(native.ImagePicker),
  "expo-location": () => withDefault(native.Location),
  "expo-local-authentication": () => withDefault(native.LocalAuthentication),
  "expo-notifications": () => withDefault(native.Notifications),
  "expo-clipboard": () => withDefault(native.Clipboard),
  "expo-sharing": () => withDefault(native.Sharing),
  "expo-linking": () => withDefault(native.Linking),
  "expo-constants": () => withDefault(native.Constants, native.Constants),
  "expo-font": () => withDefault(native.Font),
  "expo-splash-screen": () => withDefault(native.SplashScreen),
  "@react-native-async-storage/async-storage": () => {
    const s = native.makeAsyncStorage(() => dataStore.get().settings)
    return withDefault(s, s)
  },
  "react-native-gesture-handler": () => withDefault(GestureHandler),
  "react-native-reanimated": () => withDefault(Reanimated, Reanimated.default),
  "react-native-worklets": () => withDefault(Worklets),
  "react-native-screens": () => withDefault({ enableScreens() {} }),
  // Real packages, not stand-ins: AI-written Zustand stores (persisted through
  // the AsyncStorage shim above) and, once a backend is connected, Axios +
  // React Query run unmodified in the preview, the same code an export ships.
  zustand: () => withDefault(Zustand, Zustand),
  "zustand/middleware": () => withDefault(ZustandMiddleware, ZustandMiddleware),
  "@tanstack/react-query": () => withDefault(ReactQuery, ReactQuery),
  axios: () => withDefault(Axios, Axios),
  // Platform-owned project modules: the preview versions talk to the host.
  "@/theme": () => withDefault(theme, theme),
  "@/lib/backend": () => withDefault(backend, backend),
  // @/lib/api exists only once a backend is connected (written by the
  // backend-conversion step, backend/src/services/agent/backend-conversion.ts);
  // same redirect as @/lib/backend above, since its real content talks to a
  // real server the preview has no business calling directly.
  "@/lib/api": () => withDefault(api, api),
}

/** Packages generated code may import. Kept in sync with lib/app-project/rules.ts. */
export const AVAILABLE_PACKAGES = Object.keys(PACKAGES).filter((p) => !p.startsWith("@/"))

const PLATFORM_FILES: Record<string, string> = {
  "theme/index.tsx": "@/theme",
  "theme/index.ts": "@/theme",
  "lib/backend/index.ts": "@/lib/backend",
  "lib/backend/index.tsx": "@/lib/backend",
  "lib/api.ts": "@/lib/api",
  "lib/api.tsx": "@/lib/api",
}

const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", ".json", "/index.tsx", "/index.ts", "/index.js"]

function normalize(path: string) {
  const out: string[] = []
  for (const part of path.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}

export class PreviewModuleError extends Error {
  constructor(
    message: string,
    readonly file?: string
  ) {
    super(message)
  }
}

/** Resolves an import to a project file path, or null for a package. */
export function resolvePath(from: string, spec: string): string | null {
  let base: string | null = null
  if (spec.startsWith("@/")) base = spec.slice(2)
  else if (spec.startsWith("./") || spec.startsWith("../")) base = normalize(`${from.split("/").slice(0, -1).join("/")}/${spec}`)
  if (base === null) return null
  const files = moduleStore.get().modules
  for (const ext of EXTENSIONS) {
    const p = base + ext
    if (PLATFORM_FILES[p]) return PLATFORM_FILES[p]
    if (p in files) return p
  }
  return `missing:${base}`
}

type Mod = { exports: Record<string, unknown> }
let cache = new Map<string, Mod>()
let cacheVersion = -1

// Components exported by platform modules (kit/**): an element of one of
// these is marked data-kit, since its look comes from kit props, not styles.
const platformComponents = new WeakSet<object>()

// Every element remembers where it was written, as data-eid="file:line:Type",
// so the inline editor can point from the screen back to the source.
function makeJsx(file: string) {
  return function __jsx(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
    if (props && ("__source" in props || "__self" in props)) {
      const { __source, __self: _s, ...rest } = props as { __source?: { lineNumber?: number }; __self?: unknown }
      if (type !== React.Fragment && __source?.lineNumber && !("dataSet" in rest)) {
        const name = typeof type === "string" ? type : ((type as { displayName?: string; name?: string })?.displayName ?? (type as { name?: string })?.name ?? "El")
        const kit = typeof type === "function" && platformComponents.has(type)
        ;(rest as Record<string | symbol, unknown>).dataSet = kit ? { eid: `${file}:${__source.lineNumber}:${name}`, kit: "1" } : { eid: `${file}:${__source.lineNumber}:${name}` }
      }
      props = rest
    }
    return React.createElement(type as never, props, ...(children as React.ReactNode[]))
  }
}

export function requireModule(spec: string, from = ""): unknown {
  const { modules, version } = moduleStore.get()
  if (version !== cacheVersion) {
    cache = new Map()
    cacheVersion = version
  }
  if (spec in PACKAGES) return PACKAGES[spec]()
  const resolved = spec.startsWith("@/") || spec.startsWith(".") ? resolvePath(from, spec) : null
  const key = resolved ?? spec
  if (key in PACKAGES) return PACKAGES[key]()
  if (resolved === null) {
    throw new PreviewModuleError(
      `"${spec}" isn't available in the preview. Use React Native core components or one of: ${AVAILABLE_PACKAGES.join(", ")}.`,
      from
    )
  }
  if (resolved.startsWith("missing:")) throw new PreviewModuleError(`Cannot find "${spec}" (imported from ${from || "the app"}).`, from)

  const hit = cache.get(resolved)
  if (hit) return hit.exports
  const code = modules[resolved]
  const mod: Mod = { exports: {} }
  cache.set(resolved, mod)
  if (resolved.endsWith(".json")) {
    mod.exports = JSON.parse(code)
    return mod.exports
  }
  try {
    // sourceURL names the file in stack traces, so a crash can be traced back to it.
    const fn = new Function("require", "module", "exports", "__jsx", "__frag", "React", code + "\n//# sourceURL=project:///" + resolved)
    fn((s: string) => requireModule(s, resolved), mod, mod.exports, makeJsx(resolved), React.Fragment, React)
    if (isPlatformOwned(resolved)) for (const v of Object.values(mod.exports)) if (typeof v === "function") platformComponents.add(v)
  } catch (e) {
    cache.delete(resolved)
    if (e instanceof PreviewModuleError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    throw new PreviewModuleError(`${resolved}: ${msg}`, resolved)
  }
  return mod.exports
}
