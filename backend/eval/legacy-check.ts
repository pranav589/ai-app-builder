// Answers: would today's (legacy engine's) checks have accepted this change?
// Reuses the real production checks (lib/app-project/project.ts checkFile,
// lib/app-project/analyze.ts undefinedNames) rather than a reimplementation,
// so this stays accurate as those checks change.

import { autoImport, checkFile, projectExports } from "@app/shared/app-project/project"
import { undefinedNames } from "@/lib/app-project/analyze"
import { applyChangeSet } from "@/lib/verify/workspace"
import type { ChangeSet, Workspace } from "@app/shared/verify/types"

export function legacyCheck(base: Workspace, cs: ChangeSet): { accepted: boolean; problems: string[] } {
  const applied = applyChangeSet(base, cs)
  // Today's engine has no ownership rules; a change that can't even be applied counts as rejected.
  if (!applied.ws) return { accepted: false, problems: applied.diagnostics.map((d) => d.message) }
  const files = applied.ws.files
  const exports = projectExports(files)
  const problems: string[] = []
  for (const file of applied.changed) {
    const code = files[file]
    if (code === undefined) continue // deleted
    const fixed = autoImport(code, exports)
    for (const p of checkFile(file, fixed, files, { screen: file.startsWith("app/") })) problems.push(`${file}: ${p}`)
    const missing = undefinedNames(file, fixed)
    if (missing.length) problems.push(`${file}: used but never defined or imported: ${missing.join(", ")}`)
  }
  return { accepted: problems.length === 0, problems }
}
