import path from "node:path"
import ts from "typescript"

// Finds every name a generated file uses but never defines or imports
// ("TopBar is not defined" at runtime), using the TypeScript checker on that
// single file. Imports aren't resolved: anything imported counts as defined,
// so only truly missing names are reported.

const LIB_DIR = path.dirname(ts.getDefaultLibFilePath({}))
const LIBS = ["lib.es2022.full.d.ts"]

// Globals React Native code may use that aren't in the DOM/ES libs.
const PRELUDE = `declare const __DEV__: boolean
declare const require: any
declare const module: any
declare const process: any
declare const global: any
declare namespace JSX { interface IntrinsicElements { [name: string]: any } interface Element {} }
`

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve,
  noResolve: true,
  noEmit: true,
  allowJs: true,
  strict: false,
  noImplicitAny: false,
  skipLibCheck: true,
  types: [],
  lib: LIBS,
}

// Library declarations are parsed once per server process.
const libCache = new Map<string, ts.SourceFile>()
function libFile(fileName: string) {
  let sf = libCache.get(fileName)
  if (!sf) {
    const text = ts.sys.readFile(fileName)
    if (text === undefined) return undefined
    sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true)
    libCache.set(fileName, sf)
  }
  return sf
}

// "Cannot find name 'X'" and its "Did you mean" variants.
const MISSING_NAME_CODES = new Set([2304, 2552, 2582, 2583, 2662, 2663])

export function undefinedNames(filePath: string, code: string): string[] {
  // Checked as TSX so JSX parses whatever the extension.
  const fileName = `/project/${filePath.replace(/\.(tsx|ts|jsx|js)$/, "")}.tsx`
  const files = new Map([
    [fileName, code],
    ["/project/__prelude.d.ts", PRELUDE],
  ])
  const host: ts.CompilerHost = {
    getSourceFile: (f, lang) => {
      if (files.has(f)) return ts.createSourceFile(f, files.get(f)!, lang, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      return libFile(f.startsWith(LIB_DIR) ? f : path.join(LIB_DIR, path.basename(f)))
    },
    getDefaultLibFileName: () => path.join(LIB_DIR, LIBS[0]),
    getDefaultLibLocation: () => LIB_DIR,
    writeFile: () => {},
    getCurrentDirectory: () => "/project",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  }
  const program = ts.createProgram([fileName, "/project/__prelude.d.ts"], OPTIONS, host)
  const sf = program.getSourceFile(fileName)
  if (!sf) return []
  const out = new Set<string>()
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (!MISSING_NAME_CODES.has(d.code)) continue
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ")
    const m = /Cannot find name '([^']+)'/.exec(msg)
    if (m) out.add(m[1])
  }
  return [...out]
}
