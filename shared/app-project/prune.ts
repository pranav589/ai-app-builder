// Drops optional capability packages (and their app.json plugins) that
// nothing in the project actually imports. Every generated app's
// package.json/app.json starts from the same fixed template
// (lib/app-project/templates.ts packageJson/appJson), which lists every
// capability an app could ever need -- camera, location, biometrics,
// notifications, etc. Most apps use only a few of these, so left unpruned
// every export ships permissions and native modules it never calls.
//
// Scoped to the packages that are purely opt-in from AI-written screen code.
// The rest of the template (reanimated, worklets, gesture-handler,
// vector-icons, safe-area-context, async-storage) back the platform modules
// every app always has (@/kit, @/motion, @/theme, @/lib/backend) -- @/kit's
// Button and Card use @/motion's PressableScale unconditionally, so any app
// using @/kit (effectively all of them) needs @/motion's own deps too.
// Pruning those based on "is it imported" would never fire for a real app
// and risks a false negative that breaks the build, so they're left alone.

import { importsOf, isCodeFile, type ProjectFiles } from "./project"

/** Packages generated screens opt into individually, each tied to one capability. */
const OPTIONAL_PACKAGES: Record<string, { plugin?: string }> = {
  "expo-symbols": {},
  "expo-glass-effect": {},
  "expo-linear-gradient": {},
  "expo-blur": {},
  "expo-image": {},
  "expo-haptics": {},
  "expo-image-picker": { plugin: "expo-image-picker" },
  "expo-location": { plugin: "expo-location" },
  "expo-local-authentication": { plugin: "expo-local-authentication" },
  "expo-notifications": { plugin: "expo-notifications" },
  "expo-clipboard": {},
  "expo-sharing": {},
  "expo-linking": {},
}

function packageRoot(spec: string): string {
  const parts = spec.split("/")
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

/** Every bare package name (not a relative or "@/" project import) imported anywhere in `files`. */
export function usedPackageRoots(files: ProjectFiles): Set<string> {
  const out = new Set<string>()
  for (const [path, code] of Object.entries(files)) {
    if (!isCodeFile(path) || !code) continue
    for (const spec of importsOf(code)) {
      if (spec.startsWith(".") || spec.startsWith("@/")) continue
      out.add(packageRoot(spec))
    }
  }
  return out
}

type PackageJsonShape = { dependencies?: Record<string, string>; [key: string]: unknown }

function pruneDependencies(source: string, used: Set<string>): string {
  let pkg: PackageJsonShape
  try {
    pkg = JSON.parse(source) as PackageJsonShape
  } catch {
    return source
  }
  if (!pkg.dependencies) return source
  const dependencies = { ...pkg.dependencies }
  for (const name of Object.keys(OPTIONAL_PACKAGES)) if (name in dependencies && !used.has(name)) delete dependencies[name]
  return JSON.stringify({ ...pkg, dependencies }, null, 2) + "\n"
}

type AppJsonShape = { expo?: { plugins?: unknown[]; [key: string]: unknown }; [key: string]: unknown }

function pruneAppJsonPlugins(source: string, used: Set<string>): string {
  let app: AppJsonShape
  try {
    app = JSON.parse(source) as AppJsonShape
  } catch {
    return source
  }
  if (!app.expo?.plugins) return source
  const pluginToPackage = new Map(Object.entries(OPTIONAL_PACKAGES).filter(([, v]) => v.plugin).map(([pkg, v]) => [v.plugin as string, pkg]))
  const plugins = app.expo.plugins.filter((p) => {
    const name = typeof p === "string" ? p : Array.isArray(p) ? p[0] : undefined
    const pkg = typeof name === "string" ? pluginToPackage.get(name) : undefined
    return !pkg || used.has(pkg)
  })
  if (plugins.length === app.expo.plugins.length) return source
  return JSON.stringify({ ...app, expo: { ...app.expo, plugins } }, null, 2) + "\n"
}

/**
 * Rewrites `files`' package.json and app.json to the optional packages and
 * plugins the project actually uses. `usage` defaults to `files` itself, but
 * callers that track screens separately from the rest of the project (the
 * builder's AppDoc splits them) pass the full merged project as `usage` while
 * `files` stays just the subset holding package.json/app.json.
 */
export function pruneProject(files: ProjectFiles, usage: ProjectFiles = files): ProjectFiles {
  const used = usedPackageRoots(usage)
  const out = { ...files }
  if (out["package.json"]) out["package.json"] = pruneDependencies(out["package.json"], used)
  if (out["app.json"]) out["app.json"] = pruneAppJsonPlugins(out["app.json"], used)
  return out
}
