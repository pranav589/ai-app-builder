import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { SDK_MODULES, type Workspace } from "../core/workspace"

// Writes a real, standalone Expo SDK 58 project to disk: our SDK and the compiler's
// output run unmodified on it. Dependency versions are the ones the main app's
// lib/app-project/templates.ts already uses for real devices (Expo SDK 58.0.25 /
// bundledNativeModules.json), trimmed to what this POC's SDK actually imports
// (react, react-native only — no AsyncStorage, no native Expo modules).
//
// Our own nav/shell are an in-memory router, not Expo Router's file-based routing, so
// the exported app/ (Expo Router's reserved directory) holds a single route that boots
// our app; everything else lives under src/ and sdk/, matched by tsconfig paths.

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n"
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-app"

function packageJson(name: string) {
  return json({
    name: slug(name),
    version: "1.0.0",
    main: "expo-router/entry",
    private: true,
    scripts: { start: "expo start", android: "expo start --android", ios: "expo start --ios", web: "expo start --web" },
    // Same versions as lib/app-project/templates.ts (Expo SDK 58.0.25 / bundledNativeModules.json),
    // trimmed to what this POC's SDK actually imports.
    dependencies: {
      expo: "~58.0.25",
      "expo-router": "~58.0.31",
      "expo-status-bar": "~58.0.5",
      "expo-constants": "~58.0.16",
      "expo-linking": "~58.0.17",
      react: "19.3.0",
      "react-dom": "19.3.0",
      "react-native": "0.88.1",
      "react-native-web": "~0.21.4",
      "react-native-safe-area-context": "~5.11.1",
      "react-native-screens": "~4.30.1",
      "react-native-gesture-handler": "~3.3.0",
    },
    devDependencies: { typescript: "~6.0.3", "@types/react": "~19.3.0" },
  })
}

function appJson(appName: string, primaryColor: string) {
  const s = slug(appName)
  return json({
    expo: {
      name: appName,
      slug: s,
      scheme: s.replace(/-/g, ""),
      version: "1.0.0",
      orientation: "portrait",
      userInterfaceStyle: "automatic",
      newArchEnabled: true,
      ios: { supportsTablet: false, bundleIdentifier: `com.verifiedcodepoc.${s.replace(/-/g, "")}` },
      android: { package: `com.verifiedcodepoc.${s.replace(/-/g, "")}`, adaptiveIcon: { backgroundColor: primaryColor } },
      plugins: ["expo-router"],
      experiments: { typedRoutes: false },
    },
  })
}

const TSCONFIG = json({
  extends: "expo/tsconfig.base",
  compilerOptions: { strict: true, paths: { "@/*": ["./src/*"], "@app/*": ["./sdk/*"] } },
  include: ["**/*.ts", "**/*.tsx"],
})

const BABEL_CONFIG = `module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo"] }
}
`

const METRO_CONFIG = `const { getDefaultConfig } = require("expo/metro-config")
module.exports = getDefaultConfig(__dirname)
`

const ENTRY = `// The app's only real Expo Router route: everything else is our own in-memory
// navigation (see src/app-root.tsx), so one route is all this needs.
import * as React from "react"
import AppRoot from "@/app-root"
import { THEME } from "@/theme"
import { SEED } from "@/data"
import { INITIAL } from "@/nav"
import { ThemeProvider } from "@app/theme"
import { DataProvider, DataStore } from "@app/data-runtime"
import { NavProvider } from "@app/nav-runtime"

export default function Index() {
  return (
    <ThemeProvider theme={THEME}>
      <DataProvider store={new DataStore(SEED)}>
        <NavProvider initial={{ screen: INITIAL }}>
          <AppRoot />
        </NavProvider>
      </DataProvider>
    </ThemeProvider>
  )
}
`

function write(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

export function exportExpoProject(ws: Workspace, outDir: string) {
  write(path.join(outDir, "package.json"), packageJson(ws.manifest.app.name))
  write(path.join(outDir, "app.json"), appJson(ws.manifest.app.name, ws.manifest.theme.colors.primary))
  write(path.join(outDir, "tsconfig.json"), TSCONFIG)
  write(path.join(outDir, "babel.config.js"), BABEL_CONFIG)
  write(path.join(outDir, "metro.config.js"), METRO_CONFIG)
  write(path.join(outDir, "app", "index.tsx"), ENTRY)

  // Project files: everything under src/, with app/routes.tsx (compiler-owned; the
  // top-level App component) renamed to app-root.tsx since "app/" is Expo Router's own
  // reserved directory in the exported project.
  for (const [p, content] of Object.entries(ws.files)) {
    const dest = p === "app/routes.tsx" ? "src/app-root.tsx" : `src/${p}`
    write(path.join(outDir, dest), content)
  }

  // The SDK: read from disk (not from ws.files — it's a platform module, not a project file).
  for (const file of Object.values(SDK_MODULES)) {
    write(path.join(outDir, "sdk", path.basename(file)), readFileSync(file, "utf8"))
  }

  write(
    path.join(outDir, "README.md"),
    `# ${ws.manifest.app.name} (exported for a real device)

Generated by the verified-code POC. Real Expo SDK 58, real Metro, real React Native — nothing
simulated. Our SDK (${Object.keys(SDK_MODULES).join(", ")}) runs unmodified here; only the
entry point (app/index.tsx) is new, since Expo Router's file-based routing isn't used — this
app has its own in-memory navigation, already proven in the browser preview.

\`\`\`sh
npm install
npx expo start
\`\`\`

Then open the printed exp:// URL in Expo Go (Android/iOS), or scan the QR code if your
terminal renders it. Phone and computer must be on the same network; if the QR/URL doesn't
connect, try \`npx expo start --tunnel\`.
`
  )
  return outDir
}
