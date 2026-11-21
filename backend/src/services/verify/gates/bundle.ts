// On-demand bundle check (Phase 10): requests Metro's own bundle endpoint
// for a running device-preview lane (scripts/device-preview.ts), so a real
// Metro/babel/native-module resolution error surfaces as a diagnostic
// instead of only showing up once someone opens the app on a phone. Not run
// on every edit (lib/verify/pipeline.ts): Metro has to actually be running,
// and building the real bundle takes far longer than the other gates
// combined.

import { METRO_PORT } from "@/lib/device/export"
import type { Diagnostic, GateResult } from "@app/shared/verify/types"

const PLATFORMS = ["ios", "android"] as const
type Platform = (typeof PLATFORMS)[number]

async function checkBundle(platform: Platform): Promise<Diagnostic | null> {
  const url = `http://localhost:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=${platform}&dev=true`
  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    return {
      gate: "bundle",
      code: "metro_unreachable",
      severity: "error",
      message: `Couldn't reach Metro at ${url}. Is "npm run device -- <projectId>" running? (${e instanceof Error ? e.message : String(e)})`,
    }
  }
  if (res.ok) return null
  const body = await res.text().catch(() => "")
  return {
    gate: "bundle",
    code: `http_${res.status}`,
    severity: "error",
    message: `Metro returned ${res.status} for the ${platform} bundle.${body ? ` ${body.slice(0, 2000)}` : ""}`,
  }
}

/** Both platforms, against a running Metro instance (scripts/device-preview.ts, always on METRO_PORT); ok only when both bundle. */
export async function bundleGate(): Promise<GateResult> {
  const t0 = performance.now()
  const diagnostics: Diagnostic[] = []
  for (const platform of PLATFORMS) {
    const d = await checkBundle(platform)
    if (d) diagnostics.push(d)
  }
  return { gate: "bundle", ok: diagnostics.length === 0, ms: performance.now() - t0, diagnostics }
}
