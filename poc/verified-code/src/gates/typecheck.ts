import path from "node:path"
import ts from "typescript"

import type { Diagnostic, GateResult } from "../core/types"
import { POC_ROOT, SDK_MODULES, type Workspace } from "../core/workspace"

// A warm TypeScript language service over a virtual project. Project files live in
// memory under <poc>/.vfs/ (never written to disk); everything else (React, React
// Native's own types, the SDK sources) is read from disk, so the check is real:
// strict mode, full module resolution, no noResolve.

const slash = (p: string) => p.replace(/\\/g, "/")
const ROOT = slash(POC_ROOT)
const VFS = `${ROOT}/.vfs`
const key = (f: string) => slash(f).toLowerCase()

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  isolatedModules: true,
  noFallthroughCasesInSwitch: true,
  lib: ["lib.es2022.d.ts"],
  types: [],
  baseUrl: VFS,
  paths: {
    "@/*": [`${VFS}/*`],
    ...Object.fromEntries(Object.entries(SDK_MODULES).map(([spec, file]) => [spec, [slash(file)]])),
  },
}

export function createTypeChecker() {
  const vfs = new Map<string, { name: string; text: string; version: number }>()
  const diskCache = new Map<string, ts.IScriptSnapshot | undefined>()

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...vfs.values()].map((v) => v.name),
    getScriptVersion: (f) => String(vfs.get(key(f))?.version ?? 0),
    getScriptSnapshot: (f) => {
      const v = vfs.get(key(f))
      if (v) return ts.ScriptSnapshot.fromString(v.text)
      if (!diskCache.has(f)) {
        const text = ts.sys.readFile(f)
        diskCache.set(f, text === undefined ? undefined : ts.ScriptSnapshot.fromString(text))
      }
      return diskCache.get(f)
    },
    getCurrentDirectory: () => ROOT,
    getCompilationSettings: () => OPTIONS,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => vfs.has(key(f)) || ts.sys.fileExists(f),
    readFile: (f) => vfs.get(key(f))?.text ?? ts.sys.readFile(f),
    readDirectory: ts.sys.readDirectory,
    directoryExists: (d) => {
      const k = key(d).replace(/\/$/, "") + "/"
      for (const name of vfs.keys()) if (name.startsWith(k)) return true
      return ts.sys.directoryExists(d)
    },
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  }
  const service = ts.createLanguageService(host, ts.createDocumentRegistry())

  const rel = (f: string) => {
    const s = slash(f)
    if (s.startsWith(VFS + "/")) return s.slice(VFS.length + 1)
    if (s.startsWith(ROOT + "/")) return s.slice(ROOT.length + 1)
    return s
  }
  const lineText = (sf: ts.SourceFile, pos: number) => {
    const { line } = sf.getLineAndCharacterOfPosition(pos)
    const start = sf.getLineStarts()[line]
    const end = sf.getLineStarts()[line + 1] ?? sf.text.length
    return { line: line + 1, text: sf.text.slice(start, end).trim().slice(0, 240) }
  }

  function toDiagnostic(d: ts.Diagnostic): Diagnostic {
    const out: Diagnostic = { gate: "tsc", code: `TS${d.code}`, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start)
      out.file = rel(d.file.fileName)
      out.line = line + 1
      out.column = character + 1
    }
    const related = (d.relatedInformation ?? [])
      .filter((r) => r.file && r.start !== undefined)
      .map((r) => ({ file: rel(r.file!.fileName), ...lineText(r.file!, r.start!) }))
    if (related.length) out.related = related
    return out
  }

  /** Brings the virtual project in line with the workspace and checks every project file. */
  function check(ws: Workspace): GateResult {
    const t0 = performance.now()
    const wanted = new Set<string>()
    for (const [p, text] of Object.entries(ws.files)) {
      if (!/\.(tsx?|jsx?)$/.test(p)) continue
      const name = `${VFS}/${p}`
      const k = key(name)
      wanted.add(k)
      const prev = vfs.get(k)
      if (!prev) vfs.set(k, { name, text, version: 1 })
      else if (prev.text !== text) vfs.set(k, { name, text, version: prev.version + 1 })
    }
    for (const k of [...vfs.keys()]) if (!wanted.has(k)) vfs.delete(k)

    const diagnostics: Diagnostic[] = []
    for (const v of vfs.values()) {
      for (const d of [...service.getSyntacticDiagnostics(v.name), ...service.getSemanticDiagnostics(v.name)]) {
        if (d.category === ts.DiagnosticCategory.Error) diagnostics.push(toDiagnostic(d))
      }
    }
    return { gate: "tsc", ok: diagnostics.length === 0, ms: performance.now() - t0, diagnostics }
  }

  /** Errors in the SDK itself (should always be zero). */
  function checkSdk(): Diagnostic[] {
    const program = service.getProgram()
    if (!program) return []
    return Object.values(SDK_MODULES).flatMap((f) => {
      const sf = program.getSourceFile(slash(f)) ?? program.getSourceFile(f)
      return sf ? [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map(toDiagnostic) : []
    })
  }

  return { check, checkSdk }
}

export type TypeChecker = ReturnType<typeof createTypeChecker>

export const vfsPath = (p: string) => path.join(POC_ROOT, ".vfs", p)
