// Platform-owned files of every generated app. These are not UI: they are
// the config Expo needs, and the device version of @/theme, the one platform
// module these apps still have. Data is no longer a platform module: with no
// backend connected the AI writes its own Zustand stores (persisted to
// AsyncStorage) or plain useState, and once connected, Axios + React Query
// calls inline in the components that need them -- see CLAUDE.md/the state
// rules in agent/prompts.ts TECH_RULES. The preview runs its own version of
// @/theme (preview-runtime/shims) with the same API.

import type { AppPlan } from "@app/shared/agent/types"
import { generateDataTypes, type DataModel } from "@app/shared/app-runtime/data-model"
import type { ThemePackage } from "@app/shared/app-runtime/theme"
import { screenHref, type ProjectFiles } from "@app/shared/app-project/project"

import { slug } from "@app/shared/app-project/scaffold"
import { MOTION_LEVEL_PATH, motionLevelSource } from "./motion"

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
      // babel-preset-expo adds the worklets Babel plugin by itself whenever
      // react-native-worklets is installed, so no babel.config.js is needed.
      "react-native-reanimated": "4.7.1",
      "react-native-worklets": "0.13.0",
      "@expo/vector-icons": "^15.0.2",
      "@react-native-async-storage/async-storage": "2.2.0",
      zustand: "^5.1.0",
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
    [MOTION_LEVEL_PATH]: motionLevelSource(themes.motion ?? "subtle"),
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
  t.radius: { sm, md, lg, xl, pill }`
