// A real TypeScript check against the real types of React Native, Expo
// Router and every allowed package (vendor/type-bundle), replacing a plain
// noResolve name check with real type errors. Ported from
// poc/verified-code/src/gates/typecheck.ts, with two differences: there is
// no separate SDK (platform files like @/theme and @/lib/backend already
// live in the workspace being checked, so they just need the same @/* alias
// as everything else), and diagnostics are scoped to the files this change
// touched (`changed`), same as parse/policy: a project with pre-existing
// type errors in files an edit didn't touch shouldn't block that edit.

import { fileURLToPath } from "node:url"
import path from "node:path"
import ts from "typescript"

import type { Diagnostic, GateName, GateResult, Workspace } from "../types"

const slash = (p: string) => p.replace(/\\/g, "/")
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** vendor/type-bundle: every ALLOWED_PACKAGES package at the exact versions the exported app ships (npm run typebundle:install). */
export const TYPE_BUNDLE_ROOT = slash(path.resolve(HERE, "../../../vendor/type-bundle"))
const VFS = `${TYPE_BUNDLE_ROOT}/.vfs`

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  resolveJsonModule: true,
  isolatedModules: true,
  lib: ["lib.es2022.d.ts"],
  types: [],
  baseUrl: VFS,
  paths: { "@/*": [`${VFS}/*`] },
}

/**
 * Blocking error codes (everything else is a warning, so existing apps
 * aren't suddenly unfixable the day this gate ships). Syntax errors
 * (TS1xxx) block too, handled separately since they're a whole range.
 */
const BLOCKING_CODES = new Set([
  2304, 2552, // missing name
  2305, 2614, 2724, // missing export
  2307, // missing module
  2322, 2741, 2769, // props and assignment, including JSX props
  2345, 2554, 2555, // wrong arguments
  2339, // property doesn't exist
  18047, 18048, // possibly null/undefined
  2786, // not a valid JSX component
])
const isBlocking = (code: number) => code < 2000 || BLOCKING_CODES.has(code)

const isScriptPath = (p: string) => /\.(tsx?|jsx?)$/.test(p)

function createService() {
  const key = (f: string) => slash(f).toLowerCase()
  const vfs = new Map<string, { name: string; text: string; version: number }>()
  const diskCache = new Map<string, ts.IScriptSnapshot | undefined>()
  let scriptNames: string[] = []

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => scriptNames,
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
    getCurrentDirectory: () => TYPE_BUNDLE_ROOT,
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
    if (s.startsWith(TYPE_BUNDLE_ROOT + "/")) return s.slice(TYPE_BUNDLE_ROOT.length + 1)
    return s
  }
  const lineText = (sf: ts.SourceFile, pos: number) => {
    const { line } = sf.getLineAndCharacterOfPosition(pos)
    const start = sf.getLineStarts()[line]
    const end = sf.getLineStarts()[line + 1] ?? sf.text.length
    return { line: line + 1, text: sf.text.slice(start, end).trim().slice(0, 240) }
  }

  function toDiagnostic(d: ts.Diagnostic): Diagnostic {
    const gate: GateName = "tsc"
    const out: Diagnostic = {
      gate,
      code: `TS${d.code}`,
      severity: d.category === ts.DiagnosticCategory.Error && isBlocking(d.code) ? "error" : "warning",
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    }
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

  /** Brings the virtual project in line with the workspace and checks the files `changed` touched (everything, if omitted). */
  function check(ws: Workspace, changed?: string[]): GateResult {
    const t0 = performance.now()
    const wanted = new Set<string>()
    const names: string[] = []
    for (const [p, text] of Object.entries(ws.files)) {
      const name = `${VFS}/${p}`
      const k = key(name)
      wanted.add(k)
      const prev = vfs.get(k)
      if (!prev) vfs.set(k, { name, text, version: 1 })
      else if (prev.text !== text) vfs.set(k, { name, text, version: prev.version + 1 })
      if (isScriptPath(p)) names.push(name)
    }
    for (const k of [...vfs.keys()]) if (!wanted.has(k)) vfs.delete(k)
    scriptNames = names

    const scope = changed ? new Set(changed.map((p) => key(`${VFS}/${p}`))) : null
    const diagnostics: Diagnostic[] = []
    for (const name of scriptNames) {
      if (scope && !scope.has(key(name))) continue
      for (const d of [...service.getSyntacticDiagnostics(name), ...service.getSemanticDiagnostics(name)]) diagnostics.push(toDiagnostic(d))
    }
    const blocking = diagnostics.filter((d) => d.severity === "error")
    return { gate: "tsc", ok: blocking.length === 0, ms: performance.now() - t0, diagnostics }
  }

  return { check }
}

type Service = ReturnType<typeof createService>

// One warm LanguageService per project, so repeated checks (repair rounds,
// repeat edits) stay fast; an unrelated project's checks never invalidate it.
const MAX_SERVICES = 8
const IDLE_MS = 10 * 60 * 1000
const services = new Map<string, { service: Service; lastUsed: number }>()

function getService(projectKey: string): Service {
  const now = Date.now()
  for (const [k, e] of services) if (now - e.lastUsed > IDLE_MS) services.delete(k)

  const existing = services.get(projectKey)
  if (existing) {
    services.delete(projectKey) // re-insert to mark as most-recently-used
    existing.lastUsed = now
    services.set(projectKey, existing)
    return existing.service
  }
  const entry = { service: createService(), lastUsed: now }
  services.set(projectKey, entry)
  while (services.size > MAX_SERVICES) {
    const oldest = services.keys().next().value
    if (oldest === undefined) break
    services.delete(oldest)
  }
  return entry.service
}

/** `projectKey` identifies which warm LanguageService to reuse; omit it only for one-off checks (e.g. tests). */
export function typecheckGate(ws: Workspace, changed?: string[], projectKey = "default"): GateResult {
  return getService(projectKey).check(ws, changed)
}
