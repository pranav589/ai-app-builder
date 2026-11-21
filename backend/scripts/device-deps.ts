// One-time setup for Phase 10's device preview: installs the Expo SDK 58
// dependency set every exported project shares (lib/device/export.ts).
// Usage: npm run device:deps
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { SDK_DEPS_DIR, sharedDepsPackageJson } from "@/lib/device/export"

function main() {
  fs.mkdirSync(SDK_DEPS_DIR, { recursive: true })
  fs.writeFileSync(path.join(SDK_DEPS_DIR, "package.json"), sharedDepsPackageJson())

  console.log(`Installing the shared Expo SDK 58 dependencies into ${SDK_DEPS_DIR} ...`)
  execFileSync("npm", ["install", "--ignore-scripts"], {
    cwd: SDK_DEPS_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  console.log(`\nDone. "npm run device -- <projectId>" will now link to this install.`)
}

main()
