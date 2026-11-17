import path from "node:path"
import { build, type Plugin } from "esbuild"

import { POC_ROOT, SDK_MODULES, type Workspace } from "../core/workspace"

// Bundles a workspace into one self-contained HTML page: the app running on
// react-native-web inside a phone frame. Project files come from memory; the SDK
// and React come from disk. Open the page by double-clicking it.
//
// The initial screen can be picked with the URL hash: #screen=habitDetail&params={"id":"habit-1"}

const ENTRY = `import * as React from "react"
import { createRoot } from "react-dom/client"
import App from "@/app/routes"
import { THEME } from "@/theme"
import { SEED } from "@/data"
import { INITIAL, SCREENS } from "@/nav"
import { ThemeProvider } from "@app/theme"
import { DataProvider, DataStore } from "@app/data-runtime"
import { NavProvider } from "@app/nav-runtime"

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return <pre style={{ color: "#b3322b", padding: 16, whiteSpace: "pre-wrap", fontSize: 12 }}>{String(this.state.error.stack || this.state.error)}</pre>
    return this.props.children
  }
}

const hash = new URLSearchParams(location.hash.slice(1))
const asked = hash.get("screen")
const screen = asked && asked in SCREENS ? asked : INITIAL
let params: Record<string, unknown> | undefined
try { params = hash.get("params") ? JSON.parse(hash.get("params")!) : undefined } catch {}

createRoot(document.getElementById("root")!).render(
  <Boundary>
    <ThemeProvider theme={THEME}>
      <DataProvider store={new DataStore(SEED)}>
        <NavProvider initial={{ screen, params }}>
          <App />
        </NavProvider>
      </DataProvider>
    </ThemeProvider>
  </Boundary>
)
`

function workspacePlugin(ws: Workspace): Plugin {
  const resolveProject = (base: string) => {
    for (const ext of ["", ".tsx", ".ts", "/index.ts", "/index.tsx"]) if (ws.files[base + ext] !== undefined) return base + ext
    return null
  }
  return {
    name: "workspace",
    setup(b) {
      b.onResolve({ filter: /^virtual:entry$/ }, () => ({ path: "entry.tsx", namespace: "ws" }))
      b.onResolve({ filter: /^react-native$/ }, async (args) => b.resolve("react-native-web", { resolveDir: POC_ROOT, kind: args.kind }))
      b.onResolve({ filter: /^@app\// }, (args) => {
        const file = SDK_MODULES[args.path]
        return file ? { path: file } : { errors: [{ text: `Unknown platform module ${args.path}` }] }
      })
      b.onResolve({ filter: /^@\// }, (args) => {
        const p = resolveProject(args.path.slice(2))
        return p ? { path: p, namespace: "ws" } : { errors: [{ text: `Cannot resolve ${args.path}` }] }
      })
      b.onResolve({ filter: /^\./, namespace: "ws" }, (args) => {
        const joined = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path))
        const p = resolveProject(joined)
        return p ? { path: p, namespace: "ws" } : { errors: [{ text: `Cannot resolve ${args.path} from ${args.importer}` }] }
      })
      b.onLoad({ filter: /.*/, namespace: "ws" }, (args) => ({
        contents: args.path === "entry.tsx" ? ENTRY : ws.files[args.path],
        loader: args.path.endsWith(".ts") ? "ts" : "tsx",
        resolveDir: POC_ROOT,
      }))
    },
  }
}

export async function bundleApp(ws: Workspace): Promise<string> {
  const result = await build({
    entryPoints: ["virtual:entry"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', global: "window", __DEV__: "false" },
    plugins: [workspacePlugin(ws)],
    logLevel: "silent",
    absWorkingDir: POC_ROOT,
  })
  return result.outputFiles[0].text
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export async function previewHtml(ws: Workspace, title: string): Promise<string> {
  const js = await bundleApp(ws)
  const bg = ws.manifest.theme.colors.background
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #d9ddd8; font-family: system-ui, sans-serif; }
  body { display: flex; align-items: center; justify-content: center; }
  .phone { width: 390px; height: 780px; max-width: 100vw; max-height: 100vh; border-radius: 36px; overflow: hidden; background: ${bg};
           box-shadow: 0 0 0 10px #1c1f1d, 0 24px 60px rgba(0,0,0,.25); display: flex; }
  #root { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  @media (max-width: 420px) { .phone { border-radius: 0; box-shadow: none; width: 100vw; height: 100vh; } }
</style>
</head>
<body>
<div class="phone"><div id="root"></div></div>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`
}
