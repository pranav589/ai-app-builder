// Phase 10b: builds a project's current files into a real Expo static export
// (`expo export`) and uploads it to S3, so the public manifest route
// (app/api/device/[projectId]/manifest) can serve Expo Go a "build once, serve
// forever" app with no Metro process running at request time. Confirmed on a
// real phone (docs/verified-code-plan.md, Phase 10b POC notes) before this was
// written: Expo Go opens a statically served manifest + production bundle +
// assets with Metro fully stopped.
//
// Runs in-process (spawns `npx expo export`), not a queue: this app runs as a
// persistent server already (lib/device/lane.ts's Metro lane depends on the
// same assumption), so a build left running after the triggering request
// returns completes normally as part of that same long-lived process.

import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { eq } from "drizzle-orm"

import { db, deviceBuilds } from "@/db"
import { withBackend } from "@/lib/app-project/with-backend"
import { DEVICE_ROOT, exportExpoProject } from "@/lib/device/export"
import { putObject } from "@/lib/storage"
import type { FileMap } from "@app/shared/verify/types"

const EXPORT_ROOT = path.join(DEVICE_ROOT, "_hosted-export")

const CONTENT_TYPE: Record<string, string> = {
  ".js": "application/javascript",
  ".hbc": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".xml": "application/xml",
  ".html": "text/html",
  ".css": "text/css",
}

function contentTypeFor(file: string): string {
  return CONTENT_TYPE[path.extname(file).toLowerCase()] ?? "application/octet-stream"
}

function listFilesRecursive(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base))
    else out.push(path.relative(base, full))
  }
  return out
}

function runExportCli(cwd: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CI
    const win32 = process.platform === "win32"
    // spawn with shell:true on Windows joins args into one command-line string without quoting
    // them itself, so a space in outDir (this repo's own path has one) splits into extra argv
    // tokens unless quoted here.
    const quotedOutDir = win32 ? `"${outDir}"` : outDir
    // --no-bytecode: Expo Go can't load a precompiled Hermes bytecode bundle (the `expo export`
    // default) as an update -- "Expo Go runs plain JavaScript bundles, so it can't load this
    // update," found on a real device. Fine for this use case: this build only has to run in
    // Expo Go, never in a standalone compiled app that would want the faster bytecode.
    const child = spawn("npx", ["expo", "export", "--platform", "all", "--no-bytecode", "--output-dir", quotedOutDir], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: win32,
      windowsHide: true,
    })
    let log = ""
    child.stdout?.on("data", (d) => (log += d))
    child.stderr?.on("data", (d) => (log += d))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(log.trim().split(/\r?\n/).slice(-20).join("\n") || `expo export exited with code ${code}`))
    })
  })
}

/**
 * Starts a build for `projectId` if one isn't already running; returns immediately
 * (the build continues after this resolves -- poll `deviceBuilds` for its status).
 * `currentVersion` is `projects.currentVersion` at the moment of the request, stored
 * once the build is ready so the UI can tell "built" from "built, but now stale".
 */
export async function startDeviceBuild(opts: {
  projectId: string
  userId: string
  files: FileMap
  currentVersion: number
}): Promise<void> {
  const { projectId, userId, files, currentVersion } = opts

  const [existing] = await db.select({ status: deviceBuilds.status }).from(deviceBuilds).where(eq(deviceBuilds.projectId, projectId)).limit(1)
  if (existing?.status === "building") return

  await db
    .insert(deviceBuilds)
    .values({ projectId, userId, status: "building" })
    .onConflictDoUpdate({ target: deviceBuilds.projectId, set: { status: "building", error: null, updatedAt: new Date() } })

  runBuild(projectId, files, currentVersion).catch(() => {
    // Failures are already recorded on the row inside runBuild; nothing more to do here.
  })
}

async function runBuild(projectId: string, files: FileMap, currentVersion: number): Promise<void> {
  const buildId = `${Date.now()}-${randomBytes(4).toString("hex")}`
  const outDir = path.join(EXPORT_ROOT, projectId, buildId)

  try {
    const projectDir = exportExpoProject(projectId, (await withBackend(projectId, files)).files)
    fs.rmSync(outDir, { force: true, recursive: true })

    await runExportCli(projectDir, outDir)

    const s3Prefix = `device/${projectId}/${buildId}/`
    // app.json isn't part of `expo export`'s own output (only the bundle/assets/metadata are),
    // but the manifest route needs it for extra.expoClient -- upload it alongside under the
    // same prefix instead of duplicating app config into Postgres.
    await putObject(s3Prefix + "app.json", fs.readFileSync(path.join(projectDir, "app.json")), "application/json")

    // The Expo Updates protocol requires each asset's (and the bundle's) base64url SHA-256 hash
    // for integrity verification; Expo Go silently drops an asset it can't verify rather than
    // erroring, which looked like "icons just don't show up" with this omitted. Computed once
    // here (the bytes are already in hand for upload) and stored alongside instead of re-hashing
    // on every manifest request.
    const hashes: Record<string, string> = {}
    for (const rel of listFilesRecursive(outDir)) {
      const relKey = rel.split(path.sep).join("/")
      const buf = fs.readFileSync(path.join(outDir, rel))
      hashes[relKey] = createHash("sha256").update(buf).digest("base64url")
      await putObject(s3Prefix + relKey, buf, contentTypeFor(rel))
    }
    await putObject(s3Prefix + "hashes.json", Buffer.from(JSON.stringify(hashes)), "application/json")

    await db
      .update(deviceBuilds)
      .set({ status: "ready", s3Prefix, builtVersion: currentVersion, error: null, updatedAt: new Date(), finishedAt: new Date() })
      .where(eq(deviceBuilds.projectId, projectId))
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.update(deviceBuilds).set({ status: "failed", error, updatedAt: new Date(), finishedAt: new Date() }).where(eq(deviceBuilds.projectId, projectId))
  } finally {
    fs.rmSync(outDir, { force: true, recursive: true })
  }
}
