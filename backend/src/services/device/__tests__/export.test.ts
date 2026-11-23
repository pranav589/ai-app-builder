import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DeviceDepsMissingError, exportExpoProject, sharedDepsPackageJson } from "@/lib/device/export"

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "device-export-test-"))
})

afterEach(() => {
  fs.rmSync(tmp, { force: true, recursive: true })
})

/** A fake shared install, as device:deps leaves it: node_modules plus the package.json it installed from. */
function installSharedDeps(packageJson = sharedDepsPackageJson()) {
  const dir = path.join(tmp, "_deps", "sdk-58")
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), packageJson)
  return path.join(dir, "node_modules")
}

describe("exportExpoProject", () => {
  it("refuses to export before the shared deps are installed", () => {
    expect(() => exportExpoProject("proj1", { "app/home.tsx": "export default function Home() {}\n" }, tmp)).toThrow(DeviceDepsMissingError)
  })

  it("refuses to export against a shared install made from an older package list", () => {
    installSharedDeps(`{ "dependencies": { "expo": "~58.0.25" } }`)
    expect(() => exportExpoProject("proj1", { "app/home.tsx": "export default function Home() {}\n" }, tmp)).toThrow(/out of date/)
  })

  it("writes every file plus babel/metro/.gitignore, and links node_modules to the shared install", () => {
    const sdkNodeModules = installSharedDeps()
    fs.writeFileSync(path.join(sdkNodeModules, "marker.txt"), "shared\n")

    const outDir = exportExpoProject(
      "proj1",
      { "app/home.tsx": "export default function Home() {}\n", "package.json": "{}\n", "theme/index.tsx": "// theme\n" },
      tmp
    )

    expect(fs.readFileSync(path.join(outDir, "app/home.tsx"), "utf8")).toContain("export default function Home")
    expect(fs.existsSync(path.join(outDir, "babel.config.js"))).toBe(true)
    expect(fs.existsSync(path.join(outDir, "metro.config.js"))).toBe(true)
    expect(fs.existsSync(path.join(outDir, ".gitignore"))).toBe(true)
    // node_modules is linked to the shared install, not copied: the marker file is reachable through it.
    expect(fs.readFileSync(path.join(outDir, "node_modules", "marker.txt"), "utf8")).toBe("shared\n")
  })

  it("gives each project its own Metro cache, so a shared node_modules can't serve another project's routes", () => {
    installSharedDeps()
    const a = exportExpoProject("proj-a", { "app/home.tsx": "" }, tmp)
    const b = exportExpoProject("proj-b", { "app/home.tsx": "" }, tmp)
    expect(fs.readFileSync(path.join(a, "metro.config.js"), "utf8")).toContain(`config.cacheVersion = "proj-a"`)
    expect(fs.readFileSync(path.join(b, "metro.config.js"), "utf8")).toContain(`config.cacheVersion = "proj-b"`)
  })

  it("drops a file from a previous export that the current workspace no longer has", () => {
    installSharedDeps()
    const first = exportExpoProject("proj1", { "app/old-screen.tsx": "export default function Old() {}\n" }, tmp)
    expect(fs.existsSync(path.join(first, "app/old-screen.tsx"))).toBe(true)

    const second = exportExpoProject("proj1", { "app/home.tsx": "export default function Home() {}\n" }, tmp)
    expect(fs.existsSync(path.join(second, "app/old-screen.tsx"))).toBe(false)
    expect(fs.existsSync(path.join(second, "app/home.tsx"))).toBe(true)
  })

  it("installs the packages a connected app imports, so Metro never resolves them from the repo root (a second React: white screen)", () => {
    const deps = JSON.parse(sharedDepsPackageJson()).dependencies
    expect(deps).toHaveProperty("axios")
    expect(deps).toHaveProperty("@tanstack/react-query")
  })
})
