// File ownership (Section 3 of docs/verified-code-plan.md): who may write each
// path. Enforced by the gateway (workspace.ts applyChangeSet) and the policy
// gate from this phase on; extended with kit/** in Phase 7 and motion/**
// (the animation kit) after it.

const PLATFORM_PATHS = new Set(["theme/index.tsx", "theme/themes.json", "lib/backend/index.ts", "data/seed.json", "data/schema.json", "package.json", "app.json", "tsconfig.json"])

/** Written by the manifest compiler (Phase 6), never by the AI. Declared now so the gateway already refuses AI writes to them. */
const COMPILER_PATH = /^app\/_layout\.tsx$|^app\/\([^/)]+\)\/_layout\.tsx$|^app\/index\.tsx$|^lib\/nav\.ts$|^data\/types\.ts$/

export function isPlatformOwned(path: string): boolean {
  return PLATFORM_PATHS.has(path) || path.startsWith("kit/") || path.startsWith("motion/")
}

export function isCompilerOwned(path: string): boolean {
  return COMPILER_PATH.test(path)
}

/** Screen files under app/ (other than compiler-owned layouts), components/**, lib/** except platform/compiler paths. */
export function isAppOwned(path: string): boolean {
  if (isPlatformOwned(path) || isCompilerOwned(path)) return false
  return path.startsWith("app/") || path.startsWith("components/") || path.startsWith("lib/")
}
