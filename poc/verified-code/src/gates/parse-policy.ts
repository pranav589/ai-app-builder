import { transform } from "sucrase"

import type { Diagnostic, GateResult } from "../core/types"
import { isAppOwned, type Workspace } from "../core/workspace"

const MAX_LINES = 300

/** Modules app code may import. Everything else is a policy failure, not a runtime surprise. */
const ALLOWED_IMPORTS = new Set(["react", "react-native", "@app/kit", "@app/theme", "@/data", "@/nav"])

export function importsOf(code: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = []
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const spec = m[1] ?? m[2] ?? m[3]
    out.push({ spec, line: code.slice(0, m.index + m[0].length).split("\n").length })
  }
  return out
}

export function parseGate(ws: Workspace): GateResult {
  const t0 = performance.now()
  const diagnostics: Diagnostic[] = []
  for (const [file, code] of Object.entries(ws.files)) {
    if (!isAppOwned(file)) continue
    try {
      transform(code, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true, filePath: file })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const pos = /\((\d+):(\d+)\)/.exec(msg)
      diagnostics.push({ gate: "parse", code: "syntax", file, line: pos ? Number(pos[1]) : undefined, column: pos ? Number(pos[2]) : undefined, message: msg })
    }
  }
  return { gate: "parse", ok: diagnostics.length === 0, ms: performance.now() - t0, diagnostics }
}

const FORBIDDEN: { re: RegExp; code: string; message: string }[] = [
  { re: /\bfetch\s*\(/, code: "network", message: "Network calls are not allowed in app code. Use the data hooks from \"@/data\"." },
  { re: /\bXMLHttpRequest\b|\bWebSocket\b/, code: "network", message: "Network APIs are not allowed in app code." },
  { re: /\beval\s*\(|\bnew\s+Function\s*\(/, code: "eval", message: "eval and new Function are not allowed." },
  { re: /\bdangerouslySetInnerHTML\b/, code: "html", message: "Raw HTML is not allowed." },
]

export function policyGate(ws: Workspace): GateResult {
  const t0 = performance.now()
  const diagnostics: Diagnostic[] = []
  const screenIds = new Set(Object.keys(ws.manifest.screens))
  const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length

  for (const [file, code] of Object.entries(ws.files)) {
    if (!isAppOwned(file)) continue
    const lines = code.split("\n").length
    if (lines > MAX_LINES)
      diagnostics.push({ gate: "policy", code: "file_too_long", file, message: `${file} has ${lines} lines (limit ${MAX_LINES}). Move parts into components/<screen>/*.tsx.` })

    for (const { spec, line } of importsOf(code)) {
      const local = spec.startsWith(".") || spec.startsWith("@/components/") || spec.startsWith("@/lib/")
      if (!local && !ALLOWED_IMPORTS.has(spec))
        diagnostics.push({
          gate: "policy",
          code: "import_not_allowed",
          file,
          line,
          message: `Import "${spec}" is not allowed. App code may import: ${[...ALLOWED_IMPORTS].join(", ")}, and its own files under @/components/ and @/lib/.`,
        })
    }
    const body = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
    for (const f of FORBIDDEN) {
      const m = f.re.exec(body)
      if (m) diagnostics.push({ gate: "policy", code: f.code, file, line: lineOf(body, m.index), message: f.message })
    }
    const colors = [...body.matchAll(/["'`](#[0-9a-fA-F]{3,8})["'`]|\b(rgba?\([^)]*\))/g)]
    if (colors.length)
      diagnostics.push({
        gate: "policy",
        code: "literal_color",
        file,
        line: lineOf(body, colors[0].index!),
        message: `Literal color ${colors[0][1] ?? colors[0][2]} found. Use kit tone props or useTheme().colors so themes work.`,
      })
    if (file.startsWith("screens/")) {
      const id = file.slice("screens/".length, -".tsx".length)
      if (!screenIds.has(id))
        diagnostics.push({ gate: "policy", code: "orphan_screen", file, message: `screens/${id}.tsx has no screen "${id}" in the manifest. Add it with a manifest_patch or move the code to components/.` })
      if (!/export\s+default\s+function\s+\w+\s*\(\s*\)/.test(code))
        diagnostics.push({ gate: "policy", code: "screen_export", file, message: `A screen file must have "export default function Name()" with no props. Read params with useParams("${id}").` })
    }
  }
  return { gate: "policy", ok: diagnostics.length === 0, ms: performance.now() - t0, diagnostics }
}
