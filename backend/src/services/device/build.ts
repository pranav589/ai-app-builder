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
import { promisify } from "node:util"
import { gzip } from "node:zlib"
import { spawn, type ChildProcess } from "node:child_process"
import { and, eq } from "drizzle-orm"

import { db, deviceBuilds } from "@/db"
import { withBackend } from "@/lib/app-project/with-backend"
import { DEVICE_ROOT, exportExpoProject } from "@/lib/device/export"
import { putObject } from "@/lib/storage"
import type { BuildPlatform } from "@app/shared/api-types"
import type { FileMap } from "@app/shared/verify/types"

const gzipAsync = promisify(gzip)

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

const UPLOAD_CONCURRENCY = 8

/** Runs `fn` over `items` with at most `limit` in flight; rejects on the first failure. */
async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * The builds running in this process. A run that is no longer the one registered for its
 * project was stopped, so it must not write its outcome over the row (which may by now
 * belong to a newer build).
 */
type Run = { child?: ChildProcess }
const runs = new Map<string, Run>()

function killTree(child: ChildProcess) {
  // Metro spawns worker processes; on Windows child.kill() would leave them running.
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true })
  else child.kill()
}

function runExportCli(cwd: string, outDir: string, platform: BuildPlatform, run: Run): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.CI
    // Run expo's CLI through node directly: skips `npx`'s package lookup on every build, and with
    // no shell involved a space in outDir (this repo's own path has one) needs no quoting.
    const expoCli = path.join(cwd, "node_modules", "expo", "bin", "cli")
    // --no-bytecode: Expo Go can't load a precompiled Hermes bytecode bundle (the `expo export`
    // default) as an update -- "Expo Go runs plain JavaScript bundles, so it can't load this
    // update," found on a real device. Fine for this use case: this build only has to run in
    // Expo Go, never in a standalone compiled app that would want the faster bytecode.
    const child = spawn(process.execPath, [expoCli, "export", "--platform", platform, "--no-bytecode", "--output-dir", outDir], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    run.child = child
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
/** Whether this process is running a build for `projectId` right now (builds never outlive the process that started them). */
export const isDeviceBuildRunning = (projectId: string) => runs.has(projectId)

export async function startDeviceBuild(opts: {
  projectId: string
  userId: string
  files: FileMap
  currentVersion: number
  platform: BuildPlatform
}): Promise<void> {
  const { projectId, userId, files, currentVersion, platform } = opts

  // Only a build this process is running counts as in progress. A row still
  // saying "building" with no run here was orphaned by a server restart (dev's
  // `node --watch` restarts on every backend edit): no process will ever
  // finish it, so it must not block a new build.
  if (isDeviceBuildRunning(projectId)) return

  await db
    .insert(deviceBuilds)
    .values({ projectId, userId, status: "building", platform })
    .onConflictDoUpdate({ target: deviceBuilds.projectId, set: { status: "building", platform, error: null, updatedAt: new Date() } })

  const run: Run = {}
  runs.set(projectId, run)
  runBuild(projectId, files, currentVersion, platform, run).catch(() => {
    // Failures are already recorded on the row inside runBuild; nothing more to do here.
  })
}

async function runBuild(projectId: string, files: FileMap, currentVersion: number, platform: BuildPlatform, run: Run): Promise<void> {
  const buildId = `${Date.now()}-${randomBytes(4).toString("hex")}`
  const outDir = path.join(EXPORT_ROOT, projectId, buildId)

  try {
    const t0 = Date.now()
    const projectDir = exportExpoProject(projectId, (await withBackend(projectId, files)).files)
    fs.rmSync(outDir, { force: true, recursive: true })
    const tPrepared = Date.now()

    await runExportCli(projectDir, outDir, platform, run)
    const tExported = Date.now()

    const s3Prefix = `device/${projectId}/${buildId}/`
    // The Expo Updates protocol requires each asset's (and the bundle's) base64url SHA-256 hash
    // for integrity verification; Expo Go silently drops an asset it can't verify rather than
    // erroring, which looked like "icons just don't show up" with this omitted. Computed once
    // here (the bytes are already in hand for upload) and stored alongside instead of re-hashing
    // on every manifest request.
    const hashes: Record<string, string> = {}
    await mapConcurrent(listFilesRecursive(outDir), UPLOAD_CONCURRENCY, async (rel) => {
      const relKey = rel.split(path.sep).join("/")
      const buf = await fs.promises.readFile(path.join(outDir, rel))
      hashes[relKey] = createHash("sha256").update(buf).digest("base64url")
      // The JS bundle is the bulk of the upload and compresses several-fold; the hash above stays
      // over the raw bytes since that is what the phone checks after decoding Content-Encoding.
      if (path.extname(rel) === ".js") await putObject(s3Prefix + relKey, await gzipAsync(buf), contentTypeFor(rel), "gzip")
      else await putObject(s3Prefix + relKey, buf, contentTypeFor(rel))
    })
    // app.json isn't part of `expo export`'s own output (only the bundle/assets/metadata are),
    // but the manifest route needs it for extra.expoClient -- upload it alongside under the
    // same prefix instead of duplicating app config into Postgres.
    await putObject(s3Prefix + "app.json", fs.readFileSync(path.join(projectDir, "app.json")), "application/json")
    await putObject(s3Prefix + "hashes.json", Buffer.from(JSON.stringify(hashes)), "application/json")
    console.log(
      `[device-build] ${projectId} prepare=${tPrepared - t0}ms export=${tExported - tPrepared}ms upload=${Date.now() - tExported}ms`
    )

    if (runs.get(projectId) !== run) return
    runs.delete(projectId)
    await db
      .update(deviceBuilds)
      .set({ status: "ready", s3Prefix, builtVersion: currentVersion, error: null, updatedAt: new Date(), finishedAt: new Date() })
      .where(eq(deviceBuilds.projectId, projectId))
  } catch (e) {
    if (runs.get(projectId) !== run) return
    runs.delete(projectId)
    const error = e instanceof Error ? e.message : String(e)
    await db.update(deviceBuilds).set({ status: "failed", error, updatedAt: new Date(), finishedAt: new Date() }).where(eq(deviceBuilds.projectId, projectId))
  } finally {
    fs.rmSync(outDir, { force: true, recursive: true })
  }
}

/**
 * Stops a build that is still marked "building": kills its `expo export` if it runs in this
 * process, and marks the row failed either way, since a build orphaned by a restart has no
 * process left to ever finish it. Returns false when there was nothing to stop.
 */
export async function cancelDeviceBuild(projectId: string): Promise<boolean> {
  const run = runs.get(projectId)
  runs.delete(projectId)
  if (run?.child) killTree(run.child)
  const stopped = await db
    .update(deviceBuilds)
    .set({ status: "failed", error: "Stopped by you.", updatedAt: new Date(), finishedAt: new Date() })
    .where(and(eq(deviceBuilds.projectId, projectId), eq(deviceBuilds.status, "building")))
    .returning({ projectId: deviceBuilds.projectId })
  return stopped.length > 0
}
