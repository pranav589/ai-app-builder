import { readFileSync } from "node:fs"
import path from "node:path"

import { importsOf } from "../gates/parse-policy"
import { appFiles, SDK_DIR, type Workspace } from "../core/workspace"

// Builds the prompt. Stable parts (instructions, kit reference) come first so the
// gateway can cache them; the project slice and the request come last.

const kitProps = () => {
  const src = readFileSync(path.join(SDK_DIR, "kit.tsx"), "utf8")
  const m = /\/\/ #region props\n([\s\S]*?)\/\/ #endregion props/.exec(src)
  return m ? m[1].trim() : ""
}

export const SYSTEM_PROMPT = () => `You are a senior React Native engineer working inside an app builder. You change one app per request by replying with a ChangeSet. A verifier runs on your reply before anyone sees it: parse, policy rules, a strict TypeScript check against the real types, and a render test that opens every screen and presses every button. If it fails you get the diagnostics and one more try.

# Project layout
- manifest.json: the app's structure (screens, navigation tabs, entities, theme). You change it only with <manifest_patch>.
- Generated from the manifest (read-only, never write them): nav/index.ts, data/index.ts, theme/index.ts, app/routes.tsx.
- You write: screens/<screenId>.tsx (one per manifest screen), components/**/*.tsx, lib/**/*.ts.

# Rules
- Every manifest screen needs screens/<screenId>.tsx with \`export default function Name()\` and no props. Wrap its content in <Screen>.
- Adding a screen = a manifest_patch adding /screens/<id> (and to /navigation/tabs if it is a tab) + the screen file. Tab screens have presentation "tab" and no params; other screens use "stack" or "modal".
- Imports allowed: "react", "react-native", "@app/kit", "@app/theme", "@/data", "@/nav", and your own "@/components/..." and "@/lib/...". Nothing else (no expo-*, no icons packages, no fetch).
- Prefer @app/kit components. You may use react-native core components for custom layouts, with colors from useTheme().colors and spacing from useTheme().space. Never write literal colors.
- Navigation: const nav = useNav(); nav.go("screenId") or nav.go("screenId", { ...params }); nav.back(). Params: const { id } = useParams("screenId").
- Data: hooks from "@/data" (see its types below). Records always have id and createdAt. A record hook returns data: T | null; handle null (the screen is also opened with an id that doesn't exist).
- Keep each file under 250 lines; split big screens into components/<screenId>/*.tsx.
- Lists need a key prop. Don't call setState during render.

# Reply format
Reply with only these blocks, no prose outside them:
<intent>One sentence describing the change.</intent>
<manifest_patch>[{"op":"add","path":"/screens/stats","value":{"title":"Stats","presentation":"tab"}}]</manifest_patch>   (omit if the manifest doesn't change)
<file path="screens/stats.tsx">
...the whole file...
</file>
<edit path="screens/home.tsx">
<<<<<<< SEARCH
exact existing lines
=======
replacement lines
>>>>>>> REPLACE
</edit>
<delete path="components/Old.tsx"/>
Use <file> for new files and for big changes; use <edit> for small changes to existing files (SEARCH must match exactly once).

# When the request needs something the platform doesn't have
Maps, push notifications, camera, payments, network calls, outside packages and native features are not available yet. Never fake them or import them. Either:
- build the closest useful version within the rules and say exactly what is missing in <intent> (for example a list of places instead of a map), or
- if no useful version exists, reply with only <question>...</question>: explain in one or two plain sentences what isn't supported yet and offer the closest alternative.
Also use <question> when the request is ambiguous in a way you can't sensibly decide yourself.

# @app/kit (props reference)
\`\`\`ts
${kitProps()}
\`\`\`
Components: Screen, Stack, Row, Text, Card, Button, IconButton, ListItem, Stat, ProgressBar, TextField, Toggle, EmptyState, Badge, Icon, Section, Divider.
Space = "none" | "xs" | "sm" | "md" | "lg" | "xl".

# @app/theme
useTheme(): { mode, colors: { primary, onPrimary, background, surface, text, textMuted, border, success, danger }, space: Record<Space, number>, radius: { sm, md, lg, pill } }
`

const stripSeed = (code: string) => code.replace(/export const SEED[\s\S]*$/, "export const SEED: Record<string, Record<string, unknown>[]> = { /* seed rows omitted */ }\n")

/** Exports and imports of every app file: a cheap repo map. */
export function repoMap(ws: Workspace) {
  return Object.entries(appFiles(ws))
    .map(([p, code]) => {
      const exports = [...code.matchAll(/export\s+(?:default\s+)?(?:function|const|type)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
      const imports = importsOf(code).map((i) => i.spec)
      return `- ${p} (${code.split("\n").length} lines) exports: ${exports.join(", ") || "-"}; imports: ${imports.join(", ")}`
    })
    .join("\n")
}

/**
 * Which app files to send in full. "all" sends everything; "focused" sends the screens the
 * request names (by id or title) plus the files they import, and only the repo map for the rest.
 */
export function selectFiles(ws: Workspace, request: string, mode: "all" | "focused"): string[] {
  const files = appFiles(ws)
  if (mode === "all") return Object.keys(files)
  const words = (s: string) => s.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  const req = words(request)
  const picked = new Set<string>()
  for (const [id, s] of Object.entries(ws.manifest.screens)) {
    const names = [words(id), s.title.toLowerCase()]
    if (names.some((n) => n.length > 2 && req.includes(n))) picked.add(`screens/${id}.tsx`)
  }
  // "detail screen" style references: match the last word of the id ("habitDetail" -> "detail").
  if (!picked.size)
    for (const id of Object.keys(ws.manifest.screens)) {
      const last = words(id).split(" ").pop()!
      if (last.length > 3 && req.includes(last)) picked.add(`screens/${id}.tsx`)
    }
  if (!picked.size) return Object.keys(files)
  for (const p of [...picked]) {
    for (const { spec } of importsOf(files[p] ?? "")) {
      if (!spec.startsWith("@/components/") && !spec.startsWith("@/lib/")) continue
      const base = spec.slice(2)
      for (const f of [base, `${base}.tsx`, `${base}.ts`]) if (files[f] !== undefined) picked.add(f)
    }
  }
  return [...picked].filter((p) => files[p] !== undefined).sort()
}

export function projectPrompt(ws: Workspace, request: string, mode: "all" | "focused" = "all") {
  const manifest = structuredClone(ws.manifest)
  for (const e of Object.values(manifest.entities)) e.seed = e.seed.slice(0, 2)
  const all = appFiles(ws)
  const chosen = selectFiles(ws, request, mode)
  const omitted = Object.keys(all).filter((p) => !chosen.includes(p))
  const files =
    chosen.map((p) => `<current path="${p}">\n${all[p]}</current>`).join("\n\n") +
    (omitted.length ? `\n\nNot shown (see the repo map; to change one of them, write the whole file): ${omitted.join(", ")}` : "")
  return `# manifest.json (seed rows shortened)
\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

# Generated API: @/nav
\`\`\`ts
${ws.files["nav/index.ts"]}\`\`\`

# Generated API: @/data
\`\`\`ts
${stripSeed(ws.files["data/index.ts"])}\`\`\`

# Repo map
${repoMap(ws)}

# Current app files
${files}

# Request
${request}`
}

export function repairPrompt(diagnostics: string, attempt: number, max: number) {
  return `The verifier rejected your change (attempt ${attempt} of ${max}). Nothing was applied; the app is unchanged.

${diagnostics}

Reply with the complete corrected change in the same format. It replaces your previous reply entirely, so include every block that is still needed (manifest_patch and all files), not only the fixed parts.`
}
