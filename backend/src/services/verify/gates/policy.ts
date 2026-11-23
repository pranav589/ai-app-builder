// Everything a file's content could get wrong that isn't a syntax error:
// disallowed imports, platform rules the AI must follow, and style warnings.
// Ported from lib/app-project/project.ts checkFile, as structured diagnostics,
// plus the new rules Phase 2 adds (forbidden APIs, file length).

import { ALLOWED_PACKAGES, PLATFORM_MODULES, importsOf, resolveProjectImport } from "@app/shared/app-project/project"
import { isAppOwned } from "@app/shared/verify/ownership"
import type { Diagnostic, GateResult, Workspace } from "@app/shared/verify/types"

const MAX_LINES = 300

const FORBIDDEN: { re: RegExp; code: string; message: string }[] = [
  // TODO(backend-conversion): once a connected app gets a real Axios/React Query layer (plan part B),
  // this message should point at it instead of just banning network calls outright.
  { re: /\bfetch\s*\(/, code: "network", message: `Network calls aren't allowed in app code: this app has no backend connected, so there's nowhere to call. Use local state (Zustand/useState) instead.` },
  { re: /\bXMLHttpRequest\b|\bWebSocket\b/, code: "network", message: "Network APIs aren't allowed in app code." },
  { re: /\beval\s*\(|\bnew\s+Function\s*\(/, code: "eval", message: "eval and new Function aren't allowed." },
]

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length

// Reanimated hooks whose callback re-runs when shared values change, with the
// argument count that includes the dependency array. On device the worklets
// Babel plugin finds the shared values a callback reads; the preview compiles
// with Sucrase, so on web Reanimated only learns them from the dependency
// array, and without one the animation silently freezes after its first frame.
const REACTIVE_HOOKS: Record<string, number> = { useAnimatedStyle: 2, useAnimatedProps: 2, useDerivedValue: 2, useAnimatedReaction: 3 }
const LAYOUT_PROP = /\b(width|height|top|left|right|bottom|margin\w*|padding\w*)\s*:/

/** The top-level arguments of the call whose "(" is at `open`, as source text (comments already stripped). */
function callArgs(code: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  for (let i = open; i < code.length; i++) {
    const c = code[i]
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === "\\") i++
    } else if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth === 0) {
        args.push(code.slice(start, i))
        break
      }
    } else if (c === "," && depth === 1) {
      args.push(code.slice(start, i))
      start = i + 1
    }
  }
  return args.map((a) => a.trim()).filter(Boolean)
}

function reanimatedDiagnostics(file: string, body: string): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const m of body.matchAll(new RegExp(`\\b(${Object.keys(REACTIVE_HOOKS).join("|")})\\s*(?:<[^>()]*>)?\\s*\\(`, "g"))) {
    const hook = m[1]
    const args = callArgs(body, m.index + m[0].length - 1)
    const line = lineOf(body, m.index)
    if (args.length < REACTIVE_HOOKS[hook])
      out.push({
        gate: "policy",
        code: "reanimated_deps",
        severity: "error",
        file,
        line,
        message: `${hook} needs a dependency array as its last argument listing the shared values and props it reads, e.g. ${hook === "useAnimatedReaction" ? "useAnimatedReaction(() => progress.value, (v) => { ... }, [progress])" : `${hook}(() => ({ opacity: progress.value }), [progress])`}. Without it the animation freezes in the web preview.`,
      })
    if (hook === "useAnimatedStyle" && args[0] && LAYOUT_PROP.test(args[0]))
      out.push({
        gate: "policy",
        code: "animated_layout_prop",
        severity: "warning",
        file,
        line,
        message: "Animate transform and opacity (translateX/Y, scale) rather than width/height/top/margin/padding: layout props re-run layout on every frame.",
      })
  }
  return out
}

/**
 * Only checks the files this change touched (`changed`); a project built
 * before this gate existed can have unrelated files that would never pass
 * it, and an edit elsewhere shouldn't be blocked by those. Import resolution
 * still sees every file, so a changed file can still reference an unchanged
 * one. `changed` omitted means check everything (a fresh build).
 *
 * `base` is the workspace before this attempt, if any. The line-count check
 * only blocks a file for getting *longer*: a file already over the limit
 * before the edit (common on real projects built before stricter
 * decomposition guidance existed) is allowed to stay as it was, just not to
 * grow. A brand-new file (no `base` entry) is held to the limit outright.
 */
export function policyGate(ws: Workspace, changed?: string[], _key?: string, base?: Workspace): GateResult {
  const t0 = performance.now()
  const diagnostics: Diagnostic[] = []
  const scope = changed ? new Set(changed) : null

  for (const [file, code] of Object.entries(ws.files)) {
    if (!isAppOwned(file)) continue
    if (scope && !scope.has(file)) continue

    const lines = code.split("\n").length
    const prevCode = base?.files[file]
    const prevLines = prevCode !== undefined ? prevCode.split("\n").length : null
    const grew = prevLines === null || lines > prevLines
    if (lines > MAX_LINES && grew)
      diagnostics.push({ gate: "policy", code: "file_too_long", severity: "error", file, message: `${file} has ${lines} lines (limit ${MAX_LINES}). Move parts into components/<name>.tsx.` })

    for (const spec of importsOf(code)) {
      if (PLATFORM_MODULES.includes(spec)) continue
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        if (!resolveProjectImport(file, spec, ws.files))
          diagnostics.push({ gate: "policy", code: "import_not_resolved", severity: "error", file, message: `Import "${spec}" does not resolve to a file in the project.` })
      } else if (!ALLOWED_PACKAGES.includes(spec)) {
        diagnostics.push({
          gate: "policy",
          code: "import_not_allowed",
          severity: "error",
          file,
          message: `Package "${spec}" is not available. Use React Native core components or: ${ALLOWED_PACKAGES.join(", ")}.`,
        })
      }
    }

    if (file.startsWith("app/") && !/export\s+default\b/.test(code))
      diagnostics.push({ gate: "policy", code: "missing_default_export", severity: "error", file, message: "The file must have a default export (the screen component)." })

    const body = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
    for (const f of FORBIDDEN) {
      const m = f.re.exec(body)
      if (m) diagnostics.push({ gate: "policy", code: f.code, severity: "error", file, line: lineOf(body, m.index), message: f.message })
    }
    diagnostics.push(...reanimatedDiagnostics(file, body))

    const literal = [...body.matchAll(/["'`](#[0-9a-fA-F]{3,8})["'`]|(rgba?\([^)]*\))/g)].filter(
      (m) => !/#(fff|ffffff|000|000000)\b/i.test(m[1] ?? "") && !/rgba?\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\b/.test(m[2] ?? "")
    )
    if (literal.length > 2)
      diagnostics.push({
        gate: "policy",
        code: "literal_color",
        severity: "warning",
        file,
        line: lineOf(body, literal[0].index!),
        message: `Found ${literal.length} hard-coded colors. Use theme colors from useTheme()/createStyles instead.`,
      })
  }
  const blocking = diagnostics.filter((d) => d.severity === "error")
  return { gate: "policy", ok: blocking.length === 0, ms: performance.now() - t0, diagnostics }
}
