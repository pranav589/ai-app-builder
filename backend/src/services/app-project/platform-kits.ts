// The platform's own source modules that generated code imports but never
// writes: the component kit (@/kit) and the motion kit (@/motion). Builds,
// edits and canvas edits all add them through here, so a fix to either kit
// reaches every project the same way.

import { KIT_PATH, KIT_SOURCE } from "./kit"
import { MOTION_LEVEL_PATH, MOTION_PATH, MOTION_SOURCE, motionLevelSource } from "./motion"

/** The kits' constant source files, by project path. */
export const PLATFORM_KIT_FILES: Record<string, string> = { [KIT_PATH]: KIT_SOURCE, [MOTION_PATH]: MOTION_SOURCE }

/**
 * The kit files a stored project is missing or holds a stale copy of. Edit
 * paths read files as persisted and don't go through a full build, so a
 * project built before a kit fix (or before the motion kit existed) would
 * otherwise keep the old copy. The motion level is per-project, so it's
 * only added when absent, never overwritten.
 */
export function platformKitUpdates(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, source] of Object.entries(PLATFORM_KIT_FILES)) if (files[path] !== source) out[path] = source
  if (!(MOTION_LEVEL_PATH in files)) out[MOTION_LEVEL_PATH] = motionLevelSource("subtle")
  return out
}

/** The "// #region props" .. "// #endregion props" slice of a kit's source, given to the coder verbatim as its prop reference. */
function propsReference(source: string): string {
  const m = /\/\/ #region props\n([\s\S]*?)\/\/ #endregion props/.exec(source)
  if (!m) throw new Error("Kit source has no // #region props .. // #endregion props block")
  return m[1].trimEnd()
}

/** Every named export a kit's source defines (components, hooks and types). */
const exportsOf = (source: string) => [...source.matchAll(/^export\s+(?:function|type|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])

export const KIT_PROPS_REFERENCE = propsReference(KIT_SOURCE)
export const KIT_EXPORTS = exportsOf(KIT_SOURCE)
export const MOTION_PROPS_REFERENCE = propsReference(MOTION_SOURCE)
export const MOTION_EXPORTS = exportsOf(MOTION_SOURCE)
