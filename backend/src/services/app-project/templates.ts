// Platform-owned files of every generated app. These are not UI: they are
// the config Expo needs, and the device versions of the two modules the
// platform owns (@/theme and @/lib/backend). The preview runs its own
// versions of those two (preview-runtime/shims) with the same API.

import type { AppPlan } from "@app/shared/agent/types"
import { generateDataTypes, type DataModel } from "@app/shared/app-runtime/data-model"
import type { ThemePackage } from "@app/shared/app-runtime/theme"
import { screenHref, type ProjectFiles } from "@app/shared/app-project/project"

import { slug } from "@app/shared/app-project/scaffold"

export { slug }

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n"

/** Exported too (lib/device/export.ts): the shared Expo SDK deps a device-preview export links to are installed from the same dependency list, so they never drift from what a real export actually needs. */
export function packageJson(name: string) {
  return json({
    name: slug(name),
    version: "1.0.0",
    main: "expo-router/entry",
    private: true,
    scripts: { start: "expo start", ios: "expo start --ios", android: "expo start --android", web: "expo start --web" },
    // Versions from Expo SDK 58's bundledNativeModules.json (expo 58.0.25) and its default template.
    dependencies: {
      expo: "~58.0.25",
      "expo-router": "~58.0.31",
      react: "19.3.0",
      "react-dom": "19.3.0",
      "react-native": "0.88.1",
      "react-native-web": "~0.21.4",
      "react-native-safe-area-context": "~5.11.1",
      "react-native-screens": "~4.30.1",
      "react-native-gesture-handler": "~3.3.0",
      "@expo/vector-icons": "^15.0.2",
      "@react-native-async-storage/async-storage": "2.2.0",
      "expo-status-bar": "~58.0.5",
      "expo-symbols": "~58.0.5",
      "expo-glass-effect": "~58.0.5",
      "expo-linear-gradient": "~58.0.4",
      "expo-blur": "~58.0.6",
      "expo-image": "~58.0.18",
      "expo-haptics": "~58.0.8",
      "expo-image-picker": "~58.0.10",
      "expo-location": "~58.0.22",
      "expo-local-authentication": "~58.0.3",
      "expo-notifications": "~58.1.9",
      "expo-clipboard": "~58.0.4",
      "expo-sharing": "~58.0.23",
      "expo-linking": "~58.0.17",
      "expo-constants": "~58.0.16",
      "expo-font": "~58.0.12",
      "expo-splash-screen": "~58.0.14",
    },
    devDependencies: { typescript: "~6.0.3", "@types/react": "~19.3.0" },
  })
}

function appJson(plan: AppPlan, themes: ThemePackage) {
  const t = themes.themes.find((x) => x.id === themes.activeId) ?? themes.themes[0]
  return json({
    expo: {
      name: plan.appName,
      slug: slug(plan.appName),
      scheme: slug(plan.appName).replace(/-/g, ""),
      version: "1.0.0",
      orientation: "portrait",
      userInterfaceStyle: "automatic",
      newArchEnabled: true,
      ios: { supportsTablet: false, bundleIdentifier: `com.anything.${slug(plan.appName).replace(/-/g, "")}` },
      android: { package: `com.anything.${slug(plan.appName).replace(/-/g, "")}`, adaptiveIcon: { backgroundColor: t.colors.primary } },
      plugins: ["expo-router", "expo-font", "expo-notifications", "expo-local-authentication", "expo-location", "expo-image-picker"],
      // SDK 58 defaults: React Compiler on, typed routes on.
      experiments: { typedRoutes: true, reactCompiler: true },
    },
  })
}

const TSCONFIG = json({ extends: "expo/tsconfig.base", compilerOptions: { strict: true, paths: { "@/*": ["./*"] } }, include: ["**/*.ts", "**/*.tsx"] })

/**
 * Expo Go runs every scanned project under its own single app install, not a
 * separate native container per project (Phase 10's device lane reuses one
 * exp:// URL for whichever project is currently exported) -- so a storage key
 * that isn't unique per app leaks one project's saved theme/data into the
 * next one tested on the same phone, which can look exactly like "the old app
 * is still open" even though the new JS bundle is the one actually running.
 * Exported so a one-off fix to this platform file can be pushed to an
 * already-built project without a full rebuild.
 */
export function themeDevice(appSlug = "app"): string {
  return String.raw`// Platform module: app themes. Screens read colors only through useTheme()
// or createStyles(), so switching theme restyles the whole app instantly.
import * as React from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import pkg from "./themes.json"

type Colors = {
  primary: string; onPrimary: string; primarySoft: string; accent: string; onAccent: string
  background: string; surface: string; surfaceAlt: string; text: string; textMuted: string
  border: string; success: string; warning: string; danger: string; overlay: string
}
type RawTheme = { id: string; name: string; mode: "light" | "dark"; radius: "sharp" | "soft" | "round"; colors: Omit<Colors, "overlay"> }

const RADII = {
  sharp: { sm: 4, md: 6, lg: 8, xl: 12, pill: 999 },
  soft: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  round: { sm: 12, md: 18, lg: 24, xl: 32, pill: 999 },
}
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 }

export type Theme = { id: string; name: string; mode: "light" | "dark"; dark: boolean; colors: Colors; radius: typeof RADII.soft; spacing: typeof spacing }

function toTheme(t: RawTheme): Theme {
  return {
    id: t.id, name: t.name, mode: t.mode, dark: t.mode === "dark",
    colors: { ...t.colors, overlay: t.mode === "dark" ? "rgba(0,0,0,0.6)" : "rgba(15,18,25,0.38)" },
    radius: RADII[t.radius] ?? RADII.soft,
    spacing,
  }
}

const themes = (pkg.themes as RawTheme[]).map(toTheme)
const KEY = ${JSON.stringify(`app:${appSlug}:theme`)}
const Ctx = React.createContext<{ theme: Theme; setTheme: (id: string) => void }>({ theme: themes[0], setTheme: () => {} })

export function ThemeProvider({ children }: { children?: React.ReactNode }) {
  const [id, setId] = React.useState<string>(pkg.activeId)
  React.useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => v && setId(v))
  }, [])
  const theme = themes.find((t) => t.id === id) ?? themes[0]
  const value = React.useMemo(() => ({ theme, setTheme: (next: string) => { setId(next); AsyncStorage.setItem(KEY, next) } }), [theme])
  return React.createElement(Ctx.Provider, { value }, children)
}

export const useTheme = () => React.useContext(Ctx).theme

export function createStyles<T>(factory: (t: Theme) => T): () => T {
  const memo = new WeakMap<Theme, T>()
  return function useStyles() {
    const t = useTheme()
    let s = memo.get(t)
    if (!s) { s = factory(t); memo.set(t, s) }
    return s
  }
}

export function useThemeSwitcher() {
  const { theme, setTheme } = React.useContext(Ctx)
  return { themes, activeId: theme.id, setTheme }
}
`
}

/**
 * The device backend. useCollection/useRecord get a typed overload per
 * collection (from @/data/types, generated by generateDataTypes) plus the
 * original untyped signature for a collection the data model doesn't know
 * about; the runtime body is identical either way. Only types change here;
 * the preview shim (preview-runtime/shims/backend.ts) is a separate runtime
 * used only by the live preview bundle and isn't part of the type-checked
 * project, so it's untouched.
 */
/**
 * `appSlug` namespaces the AsyncStorage key per app, for the same reason
 * `themeDevice` does above: Expo Go hosts every scanned project in one
 * install, so an unscoped key would leak one project's saved data into the
 * next project tested on the same phone.
 * Exported so a one-off fix to this platform file can be pushed to an
 * already-built project without a full rebuild.
 */
export function backendDevice(appSlug = "app"): string {
  return String.raw`// Platform module: the app's data, auth and file storage.
// Runs on the device's local storage until the app is connected to a
// backend; then the same functions call that backend's database, storage and
// auth, and no screen has to change.
import * as React from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import seed from "@/data/seed.json"
import type { Collections } from "@/data/types"

type Rec = Record<string, unknown> & { id: string; createdAt: string; updatedAt?: string }
type Where = Partial<Record<string, unknown>> | ((r: Rec) => boolean)
type QueryOpts = { where?: Where; sort?: string; limit?: number }
type User = { id: string; name: string; email: string }
type State = { seedHash: string; collections: Record<string, Rec[]>; settings: Record<string, unknown>; users: (User & { password: string })[]; session: string | null }

const KEY = ${JSON.stringify(`app:${appSlug}:data`)}
let state: State | null = null
const listeners = new Set<() => void>()

function fresh(): State {
  const collections: Record<string, Rec[]> = {}
  for (const [name, rows] of Object.entries(seed.collections as Record<string, Record<string, unknown>[]>)) {
    collections[name] = rows.map((r, i) => ({ ...r, id: String(r.id), createdAt: (r.createdAt as string) ?? new Date(Date.now() - i * 3600000).toISOString() }))
  }
  return { seedHash: seed.hash, collections, settings: { ...(seed.settings as Record<string, unknown>) }, users: [], session: null }
}

async function load(): Promise<State> {
  if (state) return state
  // A read that fails OR one that never settles at all must still resolve to
  // something, or useCollection/useSetting stay "loading" forever with
  // nothing else awaiting this promise to report it.
  const timedOut = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3000))
  try {
    const raw = await Promise.race([AsyncStorage.getItem(KEY), timedOut])
    const parsed = raw && raw !== "timeout" ? (JSON.parse(raw) as State) : null
    state = parsed && parsed.seedHash === seed.hash ? parsed : fresh()
  } catch (e) {
    console.error("Couldn't read stored data; starting fresh.", e)
    state = fresh()
  }
  return state
}

function notify() {
  for (const l of listeners) l()
}

// Replaces "state" wholesale (never mutates it in place): useSyncExternalStore's
// snapshot is "state" itself, so its reference must actually change for React,
// and the React Compiler, to see a render as depending on anything new.
function setState(next: State) {
  state = next
  void AsyncStorage.setItem(KEY, JSON.stringify(next))
  notify()
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

function query(rows: Rec[], opts: QueryOpts = {}) {
  let out = rows.slice()
  const w = opts.where
  if (typeof w === "function") out = out.filter(w)
  else if (w) out = out.filter((r) => Object.entries(w).every(([k, v]) => r[k] === v))
  if (opts.sort) {
    const desc = opts.sort.startsWith("-")
    const key = desc ? opts.sort.slice(1) : opts.sort
    out.sort((a, b) => {
      const x = a[key] as never, y = b[key] as never
      if (x === y) return 0
      if (x == null) return 1
      if (y == null) return -1
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return desc ? -r : r
    })
  }
  return opts.limit ? out.slice(0, opts.limit) : out
}

export const db = {
  async list(collection: string, opts?: QueryOpts) { return query((await load()).collections[collection] ?? [], opts) },
  async get(collection: string, id: string) { return ((await load()).collections[collection] ?? []).find((r) => r.id === id) ?? null },
  async insert(collection: string, values: Record<string, unknown>) {
    const s = await load()
    const rec: Rec = { ...values, id: newId(), createdAt: new Date().toISOString() }
    setState({ ...s, collections: { ...s.collections, [collection]: [rec, ...(s.collections[collection] ?? [])] } })
    return rec
  },
  async update(collection: string, id: string, patch: Record<string, unknown>) {
    const s = await load()
    const rows = s.collections[collection] ?? []
    const i = rows.findIndex((r) => r.id === id)
    if (i === -1) throw new Error("That item no longer exists.")
    const updated: Rec = { ...rows[i], ...patch, id, updatedAt: new Date().toISOString() }
    const nextRows = rows.slice()
    nextRows[i] = updated
    setState({ ...s, collections: { ...s.collections, [collection]: nextRows } })
    return updated
  },
  async remove(collection: string, id: string) {
    const s = await load()
    setState({ ...s, collections: { ...s.collections, [collection]: (s.collections[collection] ?? []).filter((r) => r.id !== id) } })
  },
}

export const kv = {
  async get<T = unknown>(key: string, fallback?: T) { return ((await load()).settings[key] ?? fallback) as T },
  async set(key: string, value: unknown) {
    const s = await load()
    setState({ ...s, settings: { ...s.settings, [key]: value } })
  },
}

export const auth = {
  async current(): Promise<User | null> {
    const s = await load()
    const u = s.users.find((x) => x.id === s.session)
    return u ? { id: u.id, name: u.name, email: u.email } : null
  },
  async signUp(input: { name?: string; email: string; password: string }) {
    const s = await load()
    const email = input.email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.")
    if (input.password.length < 6) throw new Error("Use at least 6 characters for the password.")
    if (s.users.some((u) => u.email === email)) throw new Error("An account with this email already exists.")
    const user = { id: newId(), name: input.name?.trim() || email.split("@")[0], email, password: input.password }
    setState({ ...s, users: [...s.users, user], session: user.id })
    return { id: user.id, name: user.name, email }
  },
  async signIn(input: { email: string; password: string }) {
    const s = await load()
    const email = input.email.trim().toLowerCase()
    const u = s.users.find((x) => x.email === email)
    if (!u) return auth.signUp({ email, password: input.password })
    if (u.password !== input.password) throw new Error("That password isn't right.")
    setState({ ...s, session: u.id })
    return { id: u.id, name: u.name, email: u.email }
  },
  async signOut() {
    const s = await load()
    setState({ ...s, session: null })
  },
  async resetPassword(_input: { email: string }) {},
}

export const storage = {
  async upload(input: { uri: string; name?: string }) { return { url: input.uri } },
}

// useSyncExternalStore, not a manual useReducer+useEffect "force a render"
// pattern: with the React Compiler on (every exported app's app.json sets
// experiments.reactCompiler), a component may only be guaranteed to see
// fresh data when it reads it from a hook's own return value -- reading
// "state" again afterwards, by closure, is exactly the kind of impure read
// the compiler's memoization can serve stale. Every hook below uses only
// the snapshot useStore() returns, never "state" directly.
function getSnapshot() {
  return state
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!state) void load().then(notify)
  return () => { listeners.delete(listener) }
}

function useStore(): State | null {
  return React.useSyncExternalStore(subscribe, getSnapshot)
}

export function useCollection<K extends keyof Collections>(
  collection: K,
  opts?: QueryOpts
): { data: Collections[K][]; loading: boolean; insert: (values: Partial<Collections[K]>) => Promise<Collections[K]>; update: (id: string, patch: Partial<Collections[K]>) => Promise<Collections[K]>; remove: (id: string) => Promise<void> }
export function useCollection(
  collection: string,
  opts?: QueryOpts
): { data: Rec[]; loading: boolean; insert: (values: Record<string, unknown>) => Promise<Rec>; update: (id: string, patch: Record<string, unknown>) => Promise<Rec>; remove: (id: string) => Promise<void> }
export function useCollection(collection: string, opts: QueryOpts = {}) {
  const snapshot = useStore()
  const data = snapshot ? query(snapshot.collections[collection] ?? [], opts) : []
  return {
    data,
    loading: !snapshot,
    insert: (values: Record<string, unknown>) => db.insert(collection, values),
    update: (id: string, patch: Record<string, unknown>) => db.update(collection, id, patch),
    remove: (id: string) => db.remove(collection, id),
  }
}

export function useRecord<K extends keyof Collections>(
  collection: K,
  id: string | undefined | null
): { data: Collections[K] | null; loading: boolean; update: (patch: Partial<Collections[K]>) => Promise<Collections[K]>; remove: () => Promise<void> }
export function useRecord(
  collection: string,
  id: string | undefined | null
): { data: Rec | null; loading: boolean; update: (patch: Record<string, unknown>) => Promise<Rec>; remove: () => Promise<void> }
export function useRecord(collection: string, id: string | undefined | null) {
  const snapshot = useStore()
  const rows = snapshot?.collections[collection] ?? []
  const data = (id ? rows.find((r) => r.id === String(id)) : rows[0]) ?? null
  return {
    data,
    loading: !snapshot,
    update: (patch: Record<string, unknown>) => (data ? db.update(collection, data.id, patch) : Promise.reject(new Error("Not found"))),
    remove: () => (data ? db.remove(collection, data.id) : Promise.resolve()),
  }
}

export function useSetting<T>(key: string, fallback: T): [T, (value: T) => Promise<void>] {
  const snapshot = useStore()
  const value = (snapshot && key in snapshot.settings ? snapshot.settings[key] : fallback) as T
  return [value, (v: T) => kv.set(key, v)]
}

export function useUser() {
  const snapshot = useStore()
  const u = snapshot?.users.find((x) => x.id === snapshot?.session) ?? null
  const fallback = seed.user as User
  return {
    user: u ? { id: u.id, name: u.name, email: u.email } : fallback,
    signedIn: !!u,
    signIn: auth.signIn,
    signUp: auth.signUp,
    signOut: auth.signOut,
  }
}
`
}

/** The platform files for an app. Regenerated whenever the plan, themes or data change. */
export function platformFiles(plan: AppPlan, themes: ThemePackage, data: DataModel): ProjectFiles {
  const first = plan.screens[0]
  const appSlug = slug(plan.appName)
  return {
    "package.json": packageJson(plan.appName),
    "app.json": appJson(plan, themes),
    "tsconfig.json": TSCONFIG,
    "app/index.tsx": `import { Redirect } from "expo-router"\n\n// The app opens on its first screen.\nexport default function Index() {\n  return <Redirect href="${first ? screenHref(first) : "/"}" />\n}\n`,
    "theme/themes.json": json({ activeId: themes.activeId, themes: themes.themes }),
    "theme/index.tsx": themeDevice(appSlug),
    "lib/backend/index.ts": backendDevice(appSlug),
    "data/seed.json": json({
      hash: data.hash,
      collections: Object.fromEntries(data.collections.map((c) => [c.name, c.seed])),
      settings: data.settings,
      user: data.user,
    }),
    "data/schema.json": json(data.collections.map(({ seed: _seed, ...c }) => c)),
    "data/types.ts": generateDataTypes(data),
  }
}

/** The API docs of the platform modules, for the AI. Kept in sync with the code above and the preview shims. */
export const PLATFORM_API_DOCS = `@/theme (platform module; import, never rewrite):
  useTheme(): Theme  // { id, name, mode: "light"|"dark", dark: boolean, colors, radius, spacing }
  createStyles((t: Theme) => ({ ...StyleSheet-like object })): () => styles   // define at module level: const useStyles = createStyles((t) => ({ container: { backgroundColor: t.colors.background } })); then inside the component: const s = useStyles()
  useThemeSwitcher(): { themes: Theme[]; activeId: string; setTheme(id: string): void }   // for an in-app appearance picker
  ThemeProvider   // wrap the root layout
  spacing: { xxs:2, xs:4, sm:8, md:12, lg:16, xl:24, xxl:32, xxxl:48 }
  t.colors: primary, onPrimary, primarySoft, accent, onAccent, background, surface, surfaceAlt, text, textMuted, border, success, warning, danger, overlay
  t.radius: { sm, md, lg, xl, pill }

@/lib/backend (platform module: local storage now, a connected backend later; import, never rewrite):
  useCollection(name, { where?: {field: value} | (record) => boolean, sort?: "field" | "-field", limit?: number })
     -> { data: Record[], loading, insert(values), update(id, patch), remove(id) }   // records have id, createdAt, updatedAt + their fields
  useRecord(name, id) -> { data: Record | null, loading, update(patch), remove() }
  useSetting(key, fallback) -> [value, setValue]
  useUser() -> { user: { name, email }, signedIn, signIn({email,password}), signUp({name,email,password}), signOut() }
  db.list/get/insert/update/remove, kv.get/set, auth.*, storage.upload({ uri }) -> { url }   // non-hook versions
  All writes are async and every screen using the hooks updates automatically.`
