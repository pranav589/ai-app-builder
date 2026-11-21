// Phase 10: the device lane as a process the Next.js dev server owns, so the
// "Test on your phone" dialog can start and stop it with a button instead of
// asking the user to run `npm run device -- <projectId>` in a terminal.
//
// Development only: Metro runs on this machine, so only a phone on the same
// Wi-Fi can reach it. Hosted users need a public URL instead (see the
// "Hosted device preview" phase in docs/verified-code-plan.md).
//
// One Metro at a time (it always binds METRO_PORT); starting a lane for
// another project stops the current one first. The state lives on
// globalThis so it survives dev-server hot reloads of this module.

import "server-only"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { withBackend } from "@/lib/app-project/with-backend"
import { DEVICE_ROOT, exportExpoProject, METRO_PORT, readDeviceLaneState } from "@/lib/device/export"
import { lanIPv4Stable } from "@/lib/device/lan"
import type { FileMap } from "@/lib/verify/types"

export type DeviceLaneStatus = {
  url: string | null
  /** "external" = started from a terminal with `npm run device`, which this server can see but not stop. */
  status: "stopped" | "starting" | "running" | "failed" | "external"
  error?: string
}

type Lane = { projectId: string; url: string; child: ChildProcess; logPath: string }

const g = globalThis as unknown as {
  __deviceLane?: Lane | null
  __deviceLaneFailure?: { projectId: string; message: string } | null
  __deviceLaneExitHook?: boolean
}

export class MetroPortBusyError extends Error {
  constructor() {
    super(`Something is already serving on port ${METRO_PORT} (perhaps "npm run device" in a terminal). Stop it, then try again.`)
  }
}

/** True when a Metro bundler answers on METRO_PORT (Metro's own /status endpoint). */
async function metroIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${METRO_PORT}/status`, { signal: AbortSignal.timeout(1000), cache: "no-store" })
    return (await res.text()).includes("packager-status:running")
  } catch {
    return false
  }
}

async function portIsTaken(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${METRO_PORT}/`, { signal: AbortSignal.timeout(1000), cache: "no-store" })
    return true
  } catch {
    return false
  }
}

/** Kills Metro and everything it spawned: with shell: true on Windows, `child` is only cmd.exe, so a plain kill() would orphan Metro on the port. */
function killTree(child: ChildProcess) {
  if (child.pid == null || child.exitCode != null) return
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  else {
    try {
      process.kill(-child.pid, "SIGTERM") // detached: true made it a process-group leader
    } catch {
      child.kill("SIGTERM")
    }
  }
}

function logTail(logPath: string, lines = 15): string {
  try {
    return fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).slice(-lines).join("\n")
  } catch {
    return ""
  }
}

export async function deviceLaneStatus(projectId: string): Promise<DeviceLaneStatus> {
  const lane = g.__deviceLane
  if (lane?.projectId === projectId) return { url: lane.url, status: (await metroIsUp()) ? "running" : "starting" }

  const failure = g.__deviceLaneFailure
  if (failure?.projectId === projectId) return { url: null, status: "failed", error: failure.message }

  // Started by scripts/device-preview.ts from a terminal (a separate process).
  const external = readDeviceLaneState(projectId)
  if (external) return { url: external.url, status: "external" }

  return { url: null, status: "stopped" }
}

/** Stops the server-owned lane (whichever project it's for) and waits for the port to be free. */
export async function stopDeviceLane(): Promise<void> {
  const lane = g.__deviceLane
  if (!lane) return
  g.__deviceLane = null
  const exited = new Promise<void>((resolve) => {
    if (lane.child.exitCode != null) return resolve()
    lane.child.once("exit", () => resolve())
    setTimeout(resolve, 5000)
  })
  killTree(lane.child)
  await exited
}

/**
 * Exports `files` and starts Metro on them, replacing any lane already
 * running (for this or another project), so pressing Start again also
 * picks up the latest edits. Resolves once Metro is spawned, not once it's
 * ready: deviceLaneStatus() reports "starting" until Metro answers.
 */
export async function startDeviceLane(projectId: string, files: FileMap): Promise<{ url: string }> {
  await stopDeviceLane()
  if (await portIsTaken()) throw new MetroPortBusyError()
  g.__deviceLaneFailure = null

  const { files: appFiles } = await withBackend(projectId, files)
  const outDir = exportExpoProject(projectId, appFiles)

  // Outside the export dir (so Metro's file watcher never sees it), and
  // truncated only here, while nothing is writing to it (POC lesson: never
  // delete or rotate the log while Metro is running).
  const logPath = path.join(DEVICE_ROOT, "_logs", `${projectId}.log`)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const logFd = fs.openSync(logPath, "w")

  const env = { ...process.env }
  delete env.CI // CI mode hides the LAN URL and changes Metro's behavior
  const child = spawn("npx", ["expo", "start", "--port", String(METRO_PORT)], {
    cwd: outDir,
    env,
    stdio: ["ignore", logFd, logFd],
    shell: process.platform === "win32", // npx is npx.cmd there, which Node won't spawn without a shell
    detached: process.platform !== "win32",
    windowsHide: true,
  })
  fs.closeSync(logFd) // the child holds its own handle

  const url = `exp://${(await lanIPv4Stable()) ?? "localhost"}:${METRO_PORT}`
  const lane: Lane = { projectId, url, child, logPath }
  g.__deviceLane = lane

  child.on("exit", (code) => {
    if (g.__deviceLane !== lane) return // stopped on purpose
    g.__deviceLane = null
    g.__deviceLaneFailure = { projectId, message: `Metro exited (code ${code ?? "?"}).\n${logTail(logPath)}`.trim() }
  })
  child.on("error", (e) => {
    if (g.__deviceLane !== lane) return
    g.__deviceLane = null
    g.__deviceLaneFailure = { projectId, message: `Couldn't start Metro: ${e.message}` }
  })

  // Don't leave Metro holding the port after the dev server itself stops.
  if (!g.__deviceLaneExitHook) {
    g.__deviceLaneExitHook = true
    process.once("exit", () => g.__deviceLane && killTree(g.__deviceLane.child))
  }

  return { url }
}
