// What the coder model sees for a given request (Phase 7). The model's
// system prompt (VERIFIED_CODER_INSTRUCTIONS) is the stable prefix: it never
// changes between calls, so a provider that caches repeated prefixes caches
// it for free (lib/verify/coder.ts sends it once, as the Agent's own
// `instructions`, not per turn). This module decides the one thing that
// still varies per request: which files, of everything in the workspace,
// are worth spending tokens on.
//
// Ported from poc/verified-code/src/agent/context.ts selectFiles.

import { importsOf } from "@app/shared/app-project/project"
import { isAppOwned } from "@app/shared/verify/ownership"
import type { Workspace } from "@app/shared/verify/types"

/**
 * The target files plus the local components/lib files they import, one
 * level deep (so a screen built on a shared component doesn't get rewritten
 * blind to it). Falls back to every app-owned file when `targetPaths` is
 * empty or none of them exist yet (a request that doesn't name a screen, or
 * names one that's still being planned).
 */
export function selectFiles(ws: Workspace, targetPaths: string[]): { path: string; code: string }[] {
  const everyAppFile = () =>
    Object.entries(ws.files)
      .filter(([p]) => isAppOwned(p))
      .map(([path, code]) => ({ path, code }))

  const picked = new Set<string>()
  for (const target of targetPaths) {
    if (ws.files[target] === undefined) continue
    picked.add(target)
    for (const spec of importsOf(ws.files[target])) {
      if (!spec.startsWith("@/components/") && !spec.startsWith("@/lib/") && !spec.startsWith("@/stores/")) continue
      const p = spec.slice(2)
      for (const f of [p, `${p}.tsx`, `${p}.ts`]) if (ws.files[f] !== undefined) picked.add(f)
    }
  }
  if (!picked.size) return everyAppFile()
  return [...picked].sort().map((path) => ({ path, code: ws.files[path] }))
}
