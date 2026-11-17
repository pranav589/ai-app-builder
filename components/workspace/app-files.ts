// The Code tab: the generated Expo project as it would be exported.

import type { GeneratedScreen } from "@/lib/agent/types"
import type { BackendConfig } from "@/lib/app-runtime/app-doc"
import type { Engine } from "@/lib/verify/engine"
import { isCompilerOwned, isPlatformOwned } from "@/lib/verify/ownership"
import type { FileNode, FileOwner } from "./types"

const LANG: Record<string, string> = { tsx: "tsx", ts: "typescript", js: "javascript", jsx: "jsx", json: "json", css: "css", md: "markdown" }
const language = (path: string) => LANG[path.split(".").pop() ?? ""] ?? "text"

/**
 * Who owns a file (Phase 9): platform files (theme, backend, config) are
 * template-written in both engines, so that's always true; the compiler
 * only exists on the verified engine (for a legacy project the same paths,
 * like app/_layout.tsx, are AI-written, which is "app").
 */
export function classifyOwner(path: string, engine: Engine): FileOwner {
  if (isPlatformOwned(path)) return "platform"
  if (engine === "verified" && isCompilerOwned(path)) return "generated"
  return "app"
}

/** Builds a sorted folder tree (folders first) from flat paths. */
function toTree(files: Record<string, string>, engine: Engine): FileNode[] {
  type Dir = { dirs: Map<string, Dir>; files: Map<string, string> }
  const root: Dir = { dirs: new Map(), files: new Map() }
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/")
    let d = root
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { dirs: new Map(), files: new Map() })
      d = d.dirs.get(p)!
    }
    d.files.set(parts[parts.length - 1], content)
  }
  const build = (d: Dir, prefix: string): FileNode[] => [
    ...[...d.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sub]): FileNode => ({ type: "folder", name, path: prefix + name, children: build(sub, `${prefix}${name}/`) })),
    ...[...d.files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, content]): FileNode => {
        const path = prefix + name
        return { type: "file", name, path, language: language(name), content, owner: classifyOwner(path, engine) }
      }),
  ]
  return build(root, "")
}

export function appFileTree({
  files,
  screens,
  backend,
  engine,
}: {
  files: Record<string, string>
  screens: GeneratedScreen[]
  backend?: BackendConfig
  engine: Engine
}): FileNode[] {
  const all: Record<string, string> = { ...files }
  // Screens show up as they are written, including the one streaming in.
  for (const s of screens) if (s.path && s.code) all[s.path] = s.code
  all["backend.config.json"] =
    JSON.stringify(
      {
        // Local storage until a CloudHike account is connected; then CloudHike Database, Storage and Auth.
        provider: backend?.provider ?? "local",
        defaultProvider: "cloudhike",
        ...(backend?.provider === "cloudhike" ? { cloudhike: { projectRef: backend.projectRef, region: backend.region } } : {}),
      },
      null,
      2
    ) + "\n"
  return toTree(all, engine)
}
