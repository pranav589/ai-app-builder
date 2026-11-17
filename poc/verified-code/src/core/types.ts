// Contracts between the layers. Everything that crosses a boundary has one of these shapes.

export type FileMap = Record<string, string>

export type JsonPatchOp =
  | { op: "add" | "replace"; path: string; value: unknown }
  | { op: "remove"; path: string }

export type FileChange =
  | { path: string; op: "write"; content: string }
  | { path: string; op: "edit"; hunks: { search: string; replace: string }[] }
  | { path: string; op: "delete" }

/** The only thing a model produces. Nothing else writes to a project. */
export interface ChangeSet {
  intent: string
  manifestPatch: JsonPatchOp[]
  files: FileChange[]
}

export type GateName = "manifest" | "parse" | "policy" | "tsc" | "render"

export interface Diagnostic {
  gate: GateName
  code: string
  message: string
  file?: string
  line?: number
  column?: number
  /** Declarations the code violated, e.g. the props type of a kit component. */
  related?: { file: string; line: number; text: string }[]
}

export interface GateResult {
  gate: GateName
  ok: boolean
  ms: number
  diagnostics: Diagnostic[]
}

export interface Snapshot {
  id: string
  parent: string | null
  createdAt: string
  author: "compiler" | "ai" | "user"
  intent: string
  /** path -> sha256 of the blob */
  tree: Record<string, string>
}

export type RunState =
  | "received"
  | "writing"
  | "verifying"
  | "repairing"
  | "committed"
  | "needs_user"
  | "failed"
