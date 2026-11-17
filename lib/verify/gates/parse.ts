import { transform } from "sucrase"

import type { Diagnostic, GateResult, Workspace } from "../types"
import { isAppOwned } from "../ownership"

/**
 * Syntax only, and only for files this change touched: a project built
 * before this gate existed (or by the legacy engine) can have unrelated
 * files that would never pass it, and an edit elsewhere shouldn't be blocked
 * by those. `changed` omitted means check everything (a fresh build).
 */
export function parseGate(ws: Workspace, changed?: string[]): GateResult {
  const t0 = performance.now()
  const diagnostics: Diagnostic[] = []
  const scope = changed ? new Set(changed) : null
  for (const [file, code] of Object.entries(ws.files)) {
    if (!isAppOwned(file)) continue
    if (scope && !scope.has(file)) continue
    try {
      transform(code, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true, filePath: file })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const pos = /\((\d+):(\d+)\)/.exec(msg)
      diagnostics.push({ gate: "parse", code: "syntax", severity: "error", file, line: pos ? Number(pos[1]) : undefined, column: pos ? Number(pos[2]) : undefined, message: msg })
    }
  }
  return { gate: "parse", ok: diagnostics.length === 0, ms: performance.now() - t0, diagnostics }
}
