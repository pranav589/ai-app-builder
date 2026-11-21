// Phase 10: exports a project's current files as a real, standalone Expo
// SDK 58 project at .device/<projectId>/, so it can run through a real
// Metro bundler and open on a real phone via Expo Go. This app's own
// projects are already real Expo Router projects (unlike the POC, which had
// its own in-memory router), so the files need no remapping: every path in
// `files` is already where a real Expo project expects it.
//
// Ported from poc/verified-code/src/expo/export.ts: babel/metro config and
// .gitignore. Dependencies are shared across every export (installed once
// with `npm run device:deps`) rather than reinstalled per project, so
// exporting is instant; node_modules is a directory junction into that
// shared install, not a copy.

import "server-only"
import fs from "node:fs"
import path from "node:path"

import { packageJson } from "@/lib/app-project/templates"
import { scaffoldFiles } from "@/lib/app-project/scaffold"
import type { FileMap } from "@/lib/verify/types"

export const DEVICE_ROOT = path.join(process.cwd(), ".device")
export const SDK_DEPS_DIR = path.join(DEVICE_ROOT, "_deps", "sdk-58")
/** scripts/device-preview.ts always starts Metro on this port, so the bundle gate and the QR dialog can both assume it without asking the running process. */
export const METRO_PORT = 8081
/** Matches templates.ts's pinned `expo: "~58.0.25"`. Metro computes both of these for a dev manifest via @expo/config's full resolution; a hosted build's hand-written manifest (lib/device/manifest.ts) has to set them itself since it only has the project's raw app.json. */
export const SDK_VERSION = "58.0.0"
export const SDK_RUNTIME_VERSION = `exposdk:${SDK_VERSION}`

export class DeviceDepsMissingError extends Error {
  constructor() {
    super(`The shared Expo dependencies aren't installed yet. Run "npm run device:deps" once, then try again.`)
  }
}

/** The shared node_modules every export links to; same dependency list a real export actually ships, so it's never short a package. */
export function sharedDepsPackageJson(): string {
  return packageJson("device-preview-shared-deps")
}

function writeFile(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/**
 * Writes `files` (and babel/metro/.gitignore) to `<deviceRoot>/<projectId>/`,
 * linking node_modules to the shared install at `<deviceRoot>/_deps/sdk-58/`.
 * Throws DeviceDepsMissingError until `npm run device:deps` has been run
 * once. `deviceRoot` defaults to DEVICE_ROOT; tests pass a temp directory.
 */
export function exportExpoProject(projectId: string, files: FileMap, deviceRoot = DEVICE_ROOT): string {
  const sdkDepsDir = path.join(deviceRoot, "_deps", "sdk-58")
  if (!fs.existsSync(path.join(sdkDepsDir, "node_modules"))) throw new DeviceDepsMissingError()

  // This writes a local dev export, never deployed output; turbopackIgnore
  // stops the build from tracing (and bundling) the whole project just
  // because the path is dynamic.
  const outDir = path.join(/*turbopackIgnore: true*/ deviceRoot, projectId)
  // A screen the AI has since deleted must not linger in a stale export.
  fs.rmSync(outDir, { force: true, recursive: true })
  for (const [p, content] of Object.entries(files)) writeFile(path.join(/*turbopackIgnore: true*/ outDir, p), content)
  const scaffold = scaffoldFiles(projectId)
  for (const [p, content] of Object.entries(scaffold)) writeFile(path.join(outDir, p), content)

  const nodeModules = path.join(outDir, "node_modules")
  fs.rmSync(nodeModules, { force: true })
  // "junction" needs no elevated privileges on Windows; ignored (a plain symlink) elsewhere.
  fs.symlinkSync(path.join(sdkDepsDir, "node_modules"), nodeModules, "junction")

  return outDir
}

// ---------------------------------------------------------------- device-lane state
//
// scripts/device-preview.ts and the Next.js dev server are separate
// processes; the only way the server's "Test on your phone" dialog
// (components/workspace/expo-qr.tsx) can know Metro is actually running,
// and at what URL, is this small state file the script writes while it's up
// and removes when it stops.

export type DeviceLaneState = { url: string; startedAt: string }

const statePath = (projectId: string) => path.join(/*turbopackIgnore: true*/ DEVICE_ROOT, projectId, "device-lane.json")

export function writeDeviceLaneState(projectId: string, state: DeviceLaneState) {
  writeFile(statePath(projectId), JSON.stringify(state, null, 2) + "\n")
}

export function clearDeviceLaneState(projectId: string) {
  fs.rmSync(statePath(projectId), { force: true })
}

/** Null when nothing is running (no script started, or it already stopped). */
export function readDeviceLaneState(projectId: string): DeviceLaneState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(projectId), "utf8"))
  } catch {
    return null
  }
}
