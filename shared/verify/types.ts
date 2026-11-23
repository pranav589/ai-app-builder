// Shared contracts for the verified-code engine. Server and browser safe: no
// Node imports, so this can be imported from client components too.

export type FileMap = Record<string, string>

export type JsonPatchOp = { op: "add" | "replace"; path: string; value: unknown } | { op: "remove"; path: string }

/** The project as the change gateway sees it. `manifest` is absent only until a project's first migration (lib/manifest/migrate.ts ensureManifest), built lazily from its AppPlan + AppDoc the first time something touches it. */
export interface Workspace {
  manifest?: unknown
  files: FileMap
}

export type FileChange =
  | { path: string; op: "write"; content: string }
  | { path: string; op: "edit"; hunks: { search: string; replace: string }[] }
  | { path: string; op: "delete" }

/** The only thing a model produces. Nothing else writes to a project. */
export interface ChangeSet {
  intent: string
  /** RFC 6902 subset; empty until Phase 6 (no manifest to patch yet). */
  manifestPatch: JsonPatchOp[]
  files: FileChange[]
}

export type GateName = "manifest" | "parse" | "policy" | "tsc" | "render" | "bundle"

export interface Diagnostic {
  gate: GateName
  /** "TS2322", "import_not_allowed", "syntax", ... */
  code: string
  /** Readable by people and models. */
  message: string
  /** Only errors block; warnings ride along. */
  severity: "error" | "warning"
  file?: string
  line?: number
  column?: number
  /** e.g. the props type a JSX usage violated. */
  related?: { file: string; line: number; text: string }[]
}

export interface GateResult {
  gate: GateName
  ok: boolean
  ms: number
  diagnostics: Diagnostic[]
}

export type RunState =
  | "received"
  | "routed"
  | "planned"
  | "writing"
  | "verifying"
  | "repairing"
  | "committed"
  | "answered"
  | "needs_user"
  | "failed"
