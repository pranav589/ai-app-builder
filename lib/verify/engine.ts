// Which pipeline a project runs on. "legacy" is today's behavior
// (lib/app-project + lib/agent/execute.ts). "verified" is the change-gateway
// pipeline built out in later phases. Every new piece of verified-engine code
// must check this before running, and do nothing for "legacy" projects.

export type Engine = "legacy" | "verified"

const ENGINES: Engine[] = ["legacy", "verified"]

export function isEngine(v: unknown): v is Engine {
  return typeof v === "string" && (ENGINES as string[]).includes(v)
}

/** The engine a project runs on, defaulting to "legacy" for anything unrecognized. */
export function engineOf(project: { engine?: string | null }): Engine {
  return isEngine(project.engine) ? project.engine : "legacy"
}

/** The engine new projects are created with. Set DEFAULT_ENGINE to "verified" to opt in. */
export const DEFAULT_ENGINE: Engine = isEngine(process.env.DEFAULT_ENGINE) ? process.env.DEFAULT_ENGINE : "legacy"
