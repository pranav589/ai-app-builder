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
import type { FileMap } from "@/lib/verify/types"

export const DEVICE_ROOT = path.join(process.cwd(), ".device")
export const SDK_DEPS_DIR = path.join(DEVICE_ROOT, "_deps", "sdk-58")
/** scripts/device-preview.ts always starts Metro on this port, so the bundle gate and the QR dialog can both assume it without asking the running process. */
export const METRO_PORT = 8081

export class DeviceDepsMissingError extends Error {
  constructor() {
    super(`The shared Expo dependencies aren't installed yet. Run "npm run device:deps" once, then try again.`)
  }
}

const BABEL_CONFIG = `module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo"] }
}
`

// expo-router's route context file lives in the shared node_modules, so its
// path and source are identical for every project, but its transform inlines
// the path to *this* project's app/ folder. Metro's transform cache is global
// and doesn't key on the project root, so without a per-project cacheVersion
// one project's bundle would load another project's screens.
const metroConfig = (projectId: string) => `const { getDefaultConfig } = require("expo/metro-config")
const config = getDefaultConfig(__dirname)
config.cacheVersion = ${JSON.stringify(projectId)}
module.exports = config
`

const GITIGNORE = "node_modules/\n.expo/\ndist/\nweb-build/\n*.log\n"

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
  writeFile(path.join(outDir, "babel.config.js"), BABEL_CONFIG)
  writeFile(path.join(outDir, "metro.config.js"), metroConfig(projectId))
  writeFile(path.join(outDir, ".gitignore"), GITIGNORE)

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
