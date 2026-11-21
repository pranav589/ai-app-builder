// The generated app is a real Expo Router project. These helpers decide where
// each planned screen lives, which packages generated code may use, and how
// files are compiled for the browser preview. Shared by server and browser.

import { transform } from "sucrase"

import type { PlanScreen } from "@app/shared/agent/types"

export type ProjectFiles = Record<string, string>

/** Where a screen's file lives. Tabs go in the (tabs) group; everything else is a stack screen. */
export function screenPath(screen: Pick<PlanScreen, "id" | "presentation">) {
  return screen.presentation === "tab" ? `app/(tabs)/${screen.id}.tsx` : `app/${screen.id}.tsx`
}

/** The URL a screen opens at. Groups like (tabs) don't appear in URLs. */
export const screenHref = (screen: Pick<PlanScreen, "id">) => `/${screen.id}`

/**
 * Packages generated code may import. The preview implements each of them
 * (preview-runtime/modules.ts) and the exported package.json installs them.
 */
export const ALLOWED_PACKAGES = [
  "react",
  "react-native",
  "expo-router",
  "expo-router/native-tabs",
  "expo-status-bar",
  "expo-symbols",
  "expo-glass-effect",
  "react-native-safe-area-context",
  "@expo/vector-icons",
  "@expo/vector-icons/Ionicons",
  "expo-linear-gradient",
  "expo-blur",
  "expo-image",
  "expo-haptics",
  "expo-image-picker",
  "expo-location",
  "expo-local-authentication",
  "expo-notifications",
  "expo-clipboard",
  "expo-sharing",
  "expo-linking",
  "expo-constants",
  "expo-font",
  "expo-splash-screen",
  "@react-native-async-storage/async-storage",
  "react-native-gesture-handler",
  "react-native-screens",
]

/** Project modules the platform owns; generated code imports them, never rewrites them. */
export const PLATFORM_MODULES = ["@/theme", "@/lib/backend"]

export const isCodeFile = (path: string) => /\.(tsx|ts|jsx|js)$/.test(path)

/** TypeScript + JSX -> CommonJS for the preview's module loader. JSX keeps source lines for inline editing. */
export function compileForPreview(path: string, code: string, local: ProjectExports = {}): string {
  if (!isCodeFile(path)) return code
  return transform(autoImport(code, local), {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "classic",
    jsxPragma: "__jsx",
    jsxFragmentPragma: "__frag",
    production: false,
    filePath: path,
  }).code
}

// Where well-known names come from. Models often use one of these without
// importing it ("useTheme is not defined"); autoImport adds the import.
const NAMED_IMPORTS: Record<string, string[]> = {
  react: ["useState", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "useReducer", "useLayoutEffect", "Fragment"],
  "react-native": [
    "View", "Text", "Pressable", "ScrollView", "FlatList", "SectionList", "TextInput", "Image", "ImageBackground", "Modal", "Switch",
    "KeyboardAvoidingView", "ActivityIndicator", "Animated", "StyleSheet", "Alert", "Share", "Linking", "Platform", "Dimensions",
    "TouchableOpacity", "TouchableWithoutFeedback", "TouchableHighlight", "Keyboard", "RefreshControl", "useWindowDimensions",
    "Easing", "LayoutAnimation", "Vibration", "ActionSheetIOS",
  ],
  "expo-router": ["router", "useRouter", "useLocalSearchParams", "useGlobalSearchParams", "Stack", "Tabs", "Link", "Redirect", "useFocusEffect", "useNavigation", "usePathname", "useSegments", "Slot"],
  "@/theme": ["useTheme", "createStyles", "useThemeSwitcher", "ThemeProvider", "spacing"],
  "@/lib/backend": ["useCollection", "useRecord", "useSetting", "useUser"],
  "@expo/vector-icons": ["Ionicons"],
  "react-native-safe-area-context": ["SafeAreaView", "useSafeAreaInsets", "SafeAreaProvider"],
  "expo-linear-gradient": ["LinearGradient"],
  "expo-blur": ["BlurView"],
  "expo-router/native-tabs": ["NativeTabs"],
  "expo-symbols": ["SymbolView"],
  "expo-glass-effect": ["GlassView", "GlassContainer", "isLiquidGlassAvailable"],
  "expo-status-bar": ["StatusBar"],
}
const NAMESPACE_IMPORTS: Record<string, string> = {
  Haptics: "expo-haptics",
  ImagePicker: "expo-image-picker",
  Location: "expo-location",
  LocalAuthentication: "expo-local-authentication",
  Notifications: "expo-notifications",
  Clipboard: "expo-clipboard",
  Sharing: "expo-sharing",
  React: "react",
}
// The backend's plain objects are only matched when used as objects (db.insert(...)).
const BACKEND_OBJECTS = ["db", "kv", "auth", "storage"]

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export type ProjectExports = Record<string, { module: string; isDefault: boolean }>

/**
 * What the project's own modules export (components/*, lib/*, ...), so a
 * screen that uses <TopBar> without importing it gets the import added.
 */
export function projectExports(files: ProjectFiles): ProjectExports {
  const out: ProjectExports = {}
  for (const [path, code] of Object.entries(files)) {
    if (!isCodeFile(path) || path.startsWith("app/") || !code) continue
    const module = "@/" + path.replace(/\.(tsx|ts|jsx|js)$/, "").replace(/\/index$/, "")
    for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) out[m[1]] ??= { module, isDefault: false }
    for (const m of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g))
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && name !== "default") out[name] ??= { module, isDefault: false }
      }
    const def = /export\s+default\s+(?:function|class)\s+([A-Za-z_$][\w$]*)/.exec(code)
    if (def) out[def[1]] ??= { module, isDefault: true }
  }
  return out
}

/** Adds imports for names a file uses but never imports or declares: well-known APIs and the project's own exports. */
export function autoImport(code: string, local: ProjectExports = {}): string {
  const importLines = code.match(/^\s*import[\s\S]*?from\s*["'][^"']+["'];?\s*$|^\s*import\s*["'][^"']+["'];?\s*$/gm) ?? []
  const imported = new Set<string>()
  for (const line of importLines) {
    for (const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\b(?=\s*(?:,|\}|$|\s+from))/g)) imported.add(m[1])
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (ns) imported.add(ns[1])
    const def = /^\s*import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/.exec(line)
    if (def) imported.add(def[1])
  }
  // Code without import lines, strings and comments, to look for real uses.
  const body = code
    .replace(/^\s*import[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""')
  const declared = (name: string) =>
    imported.has(name) ||
    new RegExp(`\\b(?:const|let|var|function|class|type|interface|enum)\\s+${escapeRe(name)}\\b`).test(body) ||
    new RegExp(`[{,]\\s*${escapeRe(name)}\\s*[,}][^=;]*=`).test(body)
  const used = (name: string) => new RegExp(`(?<![\\w$.])${escapeRe(name)}\\b(?!\\s*:)`).test(body)

  const additions = new Map<string, string[]>()
  const add = (mod: string, name: string) => additions.set(mod, [...(additions.get(mod) ?? []), name])
  for (const [mod, names] of Object.entries(NAMED_IMPORTS)) for (const n of names) if (used(n) && !declared(n)) add(mod, n)
  for (const n of BACKEND_OBJECTS) if (new RegExp(`(?<![\\w$.])${n}\\.\\w`).test(body) && !declared(n)) add("@/lib/backend", n)
  const namespaces = Object.entries(NAMESPACE_IMPORTS).filter(([n]) => new RegExp(`(?<![\\w$.])${n}\\.`).test(body) && !declared(n))
  const defaults: [string, string][] = []
  const known = new Set([...Object.values(NAMED_IMPORTS).flat(), ...Object.keys(NAMESPACE_IMPORTS)])
  for (const [n, exp] of Object.entries(local)) {
    if (known.has(n) || !used(n) || declared(n)) continue
    if (exp.isDefault) defaults.push([n, exp.module])
    else add(exp.module, n)
  }
  if (!additions.size && !namespaces.length && !defaults.length) return code

  // Never changes the line count: the preview's JSX keeps __source line
  // numbers, and the canvas inspector's eids ("file:line:Type") must point at
  // the same lines in the stored file the codemod edits.
  let out = code
  const newLines: string[] = defaults.map(([n, mod]) => `import ${n} from "${mod}"`)
  for (const [mod, names] of additions) {
    // Merge into an existing `import { ... } from "mod"` when there is one,
    // in place (a multi-line import keeps its line breaks).
    const re = new RegExp(`import\\s*(type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${escapeRe(mod)}["']`)
    const m = re.exec(out)
    if (m && !m[1]) {
      const inner = m[2]
      const head = inner.replace(/\s*$/, "")
      const tail = inner.slice(head.length)
      const sep = !head.trim() ? " " : head.endsWith(",") ? " " : ", "
      const merged = m[0].replace(`{${inner}}`, `{${head}${sep}${names.join(", ")}${tail || " "}}`)
      out = out.slice(0, m.index) + merged + out.slice(m.index + m[0].length)
    } else newLines.push(`import { ${names.join(", ")} } from "${mod}"`)
  }
  for (const [n, mod] of namespaces) newLines.push(`import * as ${n} from "${mod}"`)
  if (!newLines.length) return out
  // On the same line as the last import, or at the start of line 1.
  const lastImport = [...out.matchAll(/^\s*import[\s\S]*?from\s*["'][^"']+["'];?[ \t]*$/gm)].pop()
  if (lastImport?.index === undefined) return `${newLines.join("; ")}; ${out}`
  const at = lastImport.index + lastImport[0].length
  return `${out.slice(0, at)}; ${newLines.join("; ")}${out.slice(at)}`
}

/** Every import specifier in a file. */
export function importsOf(code: string): string[] {
  const out = new Set<string>()
  const re = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) out.add(m[1] ?? m[2] ?? m[3])
  return [...out]
}

const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", ".json", "/index.tsx", "/index.ts", "/index.js"]

function normalize(path: string) {
  const out: string[] = []
  for (const part of path.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}

/** Resolves a project import ("@/components/Card", "../lib/x") to a file, or null. */
export function resolveProjectImport(from: string, spec: string, files: ProjectFiles): string | null {
  const base = spec.startsWith("@/")
    ? spec.slice(2)
    : spec.startsWith(".")
      ? normalize(`${from.split("/").slice(0, -1).join("/")}/${spec}`)
      : null
  if (base === null) return null
  for (const ext of EXTS) if (base + ext in files) return base + ext
  return null
}

/** Problems that would stop a file from running in the preview or on a device. */
export function checkFile(path: string, code: string, files: ProjectFiles, opts: { screen?: boolean } = {}): string[] {
  const problems: string[] = []
  try {
    compileForPreview(path, code)
  } catch (e) {
    problems.push(`Syntax error: ${e instanceof Error ? e.message : String(e)}`)
    return problems
  }
  for (const spec of importsOf(code)) {
    if (PLATFORM_MODULES.includes(spec)) continue
    if (spec.startsWith("@/") || spec.startsWith(".")) {
      if (!resolveProjectImport(path, spec, files)) problems.push(`Import "${spec}" does not resolve to a file in the project.`)
    } else if (!ALLOWED_PACKAGES.includes(spec)) {
      problems.push(`Package "${spec}" is not available. Use React Native core components or: ${ALLOWED_PACKAGES.join(", ")}.`)
    }
  }
  if ((opts.screen || path.startsWith("app/")) && !/export\s+default\b/.test(code)) problems.push("The file must have a default export (the screen component).")
  // Theme switching only works when colors come from the theme.
  // Pure black/white (shadows, scrims, knobs) are fine.
  const literal = (code.match(/["'`]#[0-9a-fA-F]{3,8}["'`]|rgba?\([^)]*\)/g) ?? []).filter(
    (c) => !/#(fff|ffffff|000|000000)\b/i.test(c) && !/rgba?\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\b/.test(c)
  )
  if (literal.length > 2)
    problems.push(`Found ${literal.length} hard-coded colors (${literal.slice(0, 4).join(", ")}). Use theme colors from useTheme()/createStyles instead, so theme switching works.`)
  return problems
}
