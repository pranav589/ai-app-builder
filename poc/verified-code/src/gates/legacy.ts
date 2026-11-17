import ts from "typescript"
import { transform } from "sucrase"

import type { ChangeSet } from "../core/types"
import { applyChangeSet, isAppOwned, type Workspace } from "../core/workspace"
import { importsOf } from "./parse-policy"

// The checks today's engine runs before it accepts a file (lib/app-project/project.ts
// checkFile + lib/app-project/analyze.ts undefinedNames), reproduced here so the same
// model output can be judged by both. It answers: would the current pipeline have
// accepted this change?
//
//   - syntax (Sucrase)
//   - imports resolve to a project file or an allowed package
//   - screens have a default export
//   - more than 2 literal colors is an error
//   - names used but never defined or imported (TypeScript with noResolve)

const ALLOWED = new Set(["react", "react-native", "@app/kit", "@app/theme", "@/data", "@/nav"])
const MISSING_NAME = new Set([2304, 2552, 2582, 2583, 2662, 2663])

function undefinedNames(file: string, code: string): string[] {
  const name = `/project/${file.replace(/\.(tsx|ts)$/, "")}.tsx`
  const prelude = "/project/__prelude.d.ts"
  const sources = new Map([
    [name, code],
    [prelude, "declare namespace JSX { interface IntrinsicElements { [name: string]: any } interface Element {} }\n"],
  ])
  const libDir = ts.getDefaultLibFilePath({}).replace(/[\\/][^\\/]+$/, "")
  const host: ts.CompilerHost = {
    getSourceFile: (f, lang) =>
      sources.has(f) ? ts.createSourceFile(f, sources.get(f)!, lang, true, ts.ScriptKind.TSX) : ts.createSourceFile(f, ts.sys.readFile(f) ?? "", lang, true),
    getDefaultLibFileName: () => `${libDir}/lib.es2022.full.d.ts`,
    getDefaultLibLocation: () => libDir,
    writeFile: () => {},
    getCurrentDirectory: () => "/project",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => sources.has(f) || ts.sys.fileExists(f),
    readFile: (f) => sources.get(f) ?? ts.sys.readFile(f),
  }
  const program = ts.createProgram([name, prelude], { noResolve: true, noEmit: true, jsx: ts.JsxEmit.Preserve, strict: false, skipLibCheck: true, types: [], lib: ["lib.es2022.full.d.ts"] }, host)
  const sf = program.getSourceFile(name)
  if (!sf) return []
  const out = new Set<string>()
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (!MISSING_NAME.has(d.code)) continue
    const m = /Cannot find name '([^']+)'/.exec(ts.flattenDiagnosticMessageText(d.messageText, " "))
    if (m) out.add(m[1])
  }
  return [...out]
}

export function legacyCheck(base: Workspace, cs: ChangeSet): { accepted: boolean; problems: string[] } {
  const applied = applyChangeSet(base, cs)
  // Today's engine has no manifest or ownership rules; a change that can't even be applied counts as rejected.
  if (!applied.ws) return { accepted: false, problems: applied.diagnostics.map((d) => d.message) }
  const ws = applied.ws
  const problems: string[] = []
  for (const [file, code] of Object.entries(ws.files)) {
    if (!isAppOwned(file) || !applied.changed.includes(file)) continue
    try {
      transform(code, { transforms: ["typescript", "jsx", "imports"], filePath: file })
    } catch (e) {
      problems.push(`${file}: syntax error ${(e as Error).message}`)
      continue
    }
    for (const { spec } of importsOf(code)) {
      if (spec.startsWith("@/components/") || spec.startsWith("@/lib/") || spec.startsWith(".")) {
        const base = spec.startsWith(".") ? null : spec.slice(2)
        if (base && ![base, `${base}.tsx`, `${base}.ts`].some((p) => ws.files[p] !== undefined)) problems.push(`${file}: import ${spec} does not resolve`)
      } else if (!ALLOWED.has(spec)) problems.push(`${file}: package ${spec} not allowed`)
    }
    if (file.startsWith("screens/") && !/export\s+default\b/.test(code)) problems.push(`${file}: no default export`)
    const colors = (code.match(/["'`]#[0-9a-fA-F]{3,8}["'`]|rgba?\([^)]*\)/g) ?? []).length
    if (colors > 2) problems.push(`${file}: ${colors} hard-coded colors`)
    const missing = undefinedNames(file, code)
    if (missing.length) problems.push(`${file}: undefined names ${missing.join(", ")}`)
  }
  return { accepted: problems.length === 0, problems }
}
