// Everything a file's content could get wrong that isn't a syntax error:
// disallowed imports, platform rules the AI must follow, and style warnings.
// Ported from lib/app-project/project.ts checkFile, as structured diagnostics,
// plus the new rules Phase 2 adds (forbidden APIs, file length).

import { ALLOWED_PACKAGES, PLATFORM_MODULES, importsOf, resolveProjectImport } from "@/lib/app-project/project"
import { isAppOwned } from "../ownership"
import type { Diagnostic, GateResult, Workspace } from "../types"

const MAX_LINES = 300

const FORBIDDEN: { re: RegExp; code: string; message: string }[] = [
  { re: /\bfetch\s*\(/, code: "network", message: `Network calls aren't allowed in app code. Use "@/lib/backend" hooks instead.` },
  { re: /\bXMLHttpRequest\b|\bWebSocket\b/, code: "network", message: "Network APIs aren't allowed in app code." },
  { re: /\beval\s*\(|\bnew\s+Function\s*\(/, code: "eval", message: "eval and new Function aren't allowed." },
]

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length

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
