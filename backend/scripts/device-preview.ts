// Exports a project to a real Expo project and starts Metro on it, so it
// can be opened on a real phone through Expo Go. The "Test on your phone"
// dialog's Start button does the same from the dev server
// (lib/device/lane.ts); this terminal version shows Metro's output live.
// Usage:
//   npm run device:deps          (once)
//   npm run device -- <projectId>
//
// POC lessons carried over: never run with CI=1 (it hides the LAN URL
// Metro would otherwise print) -- not that it matters here, since the
// exp:// URL below is built from the machine's own LAN IPv4 address, not
// parsed from Metro's output (Metro only prints http://localhost:8081 when
// it isn't attached to an interactive terminal). Windows Firewall must
// allow Node to listen on the Metro port, or a phone on the same Wi-Fi
// won't be able to reach it.
import { spawn } from "node:child_process"
import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { withBackend } from "@/lib/app-project/with-backend"
import { readAppDoc } from "@app/shared/app-runtime/app-doc"
import { clearDeviceLaneState, exportExpoProject, METRO_PORT, writeDeviceLaneState } from "@/lib/device/export"
import { lanIPv4Stable } from "@/lib/device/lan"
import { workspaceFromDoc } from "@/lib/verify/workspace"

async function main() {
  const projectId = process.argv[2]
  if (!projectId) {
    console.error("Usage: npm run device -- <projectId>")
    process.exit(1)
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw new Error(`No project ${projectId}`)

  const doc = readAppDoc(project.previewScreens)
  const files = workspaceFromDoc(doc).files
  const outDir = exportExpoProject(projectId, (await withBackend(projectId, files)).files)
  console.log(`Exported "${project.name}" (${Object.keys(files).length} files) to ${outDir}`)

  const ip = await lanIPv4Stable()
  if (!ip) console.warn("Couldn't find a LAN IPv4 address on this machine; the URL below may not be reachable from a phone.")
  const url = `exp://${ip ?? "localhost"}:${METRO_PORT}`
  console.log(`\nOpen in Expo Go: ${url}\n`)
  writeDeviceLaneState(projectId, { url, startedAt: new Date().toISOString() })

  const env = { ...process.env }
  delete env.CI
  const child = spawn("npx", ["expo", "start", "--port", String(METRO_PORT)], { cwd: outDir, stdio: "inherit", shell: process.platform === "win32", env })

  const stop = () => {
    clearDeviceLaneState(projectId)
    child.kill()
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  child.on("exit", (code) => {
    clearDeviceLaneState(projectId)
    process.exit(code ?? 0)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
