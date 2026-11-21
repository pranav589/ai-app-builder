// POC for Phase 10b (docs/verified-code-plan.md): proves or disproves that Expo Go
// can open an app from a *statically served* manifest + bundle + assets, with no
// Metro running at request time -- the mechanism the "build once, serve forever"
// hosted device-preview design depends on.
//
// Method: record every request Metro answers while a real phone loads the app
// through this script's proxy, then kill Metro and replay those exact recorded
// responses from memory on the same port. If Expo Go reloads the app cleanly in
// replay mode (icons, fonts, everything), self-hosted static serving works and
// Phase 10b's primary approach is unblocked.
//
// Usage:
//   npm run device:deps          (once, if not already done)
//   npm run poc:hosted-manifest -- <projectId>
//
// Then, on your phone (same Wi-Fi as this computer):
//   1. Open Expo Go -> "Enter URL manually" -> paste the exp:// URL this script prints.
//   2. Confirm the app opens with icons/fonts/images all showing (not just text).
//   3. Navigate to every screen the app has, so every lazily-loaded route and every
//      image/font it uses gets recorded -- not just the first screen.
//   4. Come back here and press Enter: this kills Metro and switches to replay-only.
//   5. In Expo Go, force-close the app (swipe it away) and reopen the same URL.
//   6. Navigate to the same screens again. If everything looks identical with Metro
//      dead -- including images and fonts -- the POC passes.
//
// Runs Metro with --no-dev --minify (a production bundle): a dev bundle keeps retrying
// live connections (/message, /hot, /inspector/*) that a static server can't answer;
// those showed up as harmless [replay] MISS noise in the first pass of this POC.

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import readline from "node:readline/promises"
import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { exportExpoProject } from "@/lib/device/export"
import { lanIPv4 } from "@/lib/device/lan"
import { workspaceFromDoc } from "@/lib/verify/workspace"

const PUBLIC_PORT = 8081 // what the phone connects to; matches the real device lane's port
const METRO_PORT = 8092 // internal only, never given to the phone

type Recorded = { status: number; headers: http.OutgoingHttpHeaders; body: Buffer }

function requestKey(req: IncomingMessage): string {
  // Same method+path+query from the same client reliably gets the same response
  // across the record/replay boundary here, since nothing rebuilds in between.
  return `${req.method} ${req.url}`
}

// Metro builds the manifest's launchAsset.url (and hostUri/debuggerHost) from its
// own port, so the phone would fetch the bundle from Metro directly, bypassing
// (and outliving) this proxy. Point every such URL back at the public port.
function rewritePorts(body: Buffer, headers: http.IncomingHttpHeaders): { body: Buffer; headers: http.OutgoingHttpHeaders } {
  const type = String(headers["content-type"] ?? "")
  if (!/json|javascript|multipart|text/.test(type)) return { body, headers }
  const text = body.toString("utf8")
  if (!text.includes(`:${METRO_PORT}`)) return { body, headers }
  const out = Buffer.from(text.replaceAll(`:${METRO_PORT}`, `:${PUBLIC_PORT}`), "utf8")
  const rewritten: http.OutgoingHttpHeaders = { ...headers, "content-length": out.length }
  delete rewritten["transfer-encoding"]
  return { body: out, headers: rewritten }
}

// Expo Go stores every manifest it loads in SQLite with UNIQUE(scope_key, commit_time),
// so re-serving a byte-identical manifest crashes it. Metro mints a new id/createdAt per
// request; do the same.
function freshManifestIdentity(hit: Recorded): { body: Buffer; headers: http.OutgoingHttpHeaders } {
  const text = hit.body
    .toString("utf8")
    .replace(/"id":"[0-9a-f-]{36}"/, `"id":"${randomUUID()}"`)
    .replace(/"createdAt":"[^"]+"/, `"createdAt":"${new Date().toISOString()}"`)
  const body = Buffer.from(text, "utf8")
  return { body, headers: { ...hit.headers, "content-length": body.length } }
}

function killTree(child: ChildProcess) {
  if (child.pid == null || child.exitCode != null) return
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  else {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      child.kill("SIGTERM")
    }
  }
}

async function waitForMetro(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://localhost:${METRO_PORT}/status`, { signal: AbortSignal.timeout(1000) })
      if ((await res.text()).includes("packager-status:running")) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error("Metro never came up on " + METRO_PORT)
}

async function main() {
  const projectId = process.argv[2]
  if (!projectId) {
    console.error("Usage: npm run poc:hosted-manifest -- <projectId>")
    process.exit(1)
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) throw new Error(`No project ${projectId}`)

  const doc = readAppDoc(project.previewScreens)
  const files = workspaceFromDoc(doc).files
  const outDir = exportExpoProject(projectId, files)
  console.log(`Exported "${project.name}" (${Object.keys(files).length} files) to ${outDir}`)

  const env = { ...process.env }
  delete env.CI
  const metro = spawn("npx", ["expo", "start", "--port", String(METRO_PORT), "--no-dev", "--minify"], {
    cwd: outDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true,
  })
  metro.stdout?.on("data", (d) => process.stdout.write(`[metro] ${d}`))
  metro.stderr?.on("data", (d) => process.stderr.write(`[metro] ${d}`))

  console.log("Waiting for Metro to come up...")
  await waitForMetro()
  console.log("Metro is up.")

  const recorded = new Map<string, Recorded>()
  let mode: "record" | "replay" = "record"

  function serveRecorded(req: IncomingMessage, res: ServerResponse) {
    const hit = recorded.get(requestKey(req))
    if (!hit) {
      console.warn(`[replay] MISS ${requestKey(req)} -- app requested something never recorded`)
      res.writeHead(404).end()
      return
    }
    const { body, headers } = req.url === "/" ? freshManifestIdentity(hit) : hit
    console.log(`[replay] HIT  ${requestKey(req)} (${body.length} bytes)`)
    res.writeHead(hit.status, headers)
    res.end(body)
  }

  function proxyToMetro(req: IncomingMessage, res: ServerResponse) {
    const forward = http.request(
      { host: "localhost", port: METRO_PORT, path: req.url, method: req.method, headers: req.headers },
      (metroRes) => {
        const chunks: Buffer[] = []
        metroRes.on("data", (c) => chunks.push(c))
        metroRes.on("end", () => {
          const { body, headers } = rewritePorts(Buffer.concat(chunks), metroRes.headers)
          const key = requestKey(req)
          recorded.set(key, { status: metroRes.statusCode ?? 200, headers, body })
          console.log(`[record] ${key} -> ${metroRes.statusCode} (${body.length} bytes)`)
          res.writeHead(metroRes.statusCode ?? 200, headers)
          res.end(body)
        })
      }
    )
    forward.on("error", (e) => {
      console.error(`[record] forward error for ${requestKey(req)}:`, e.message)
      res.writeHead(502).end()
    })
    req.pipe(forward)
  }

  const server = http.createServer((req, res) => {
    if (mode === "record") proxyToMetro(req, res)
    else serveRecorded(req, res)
  })
  await new Promise<void>((resolve) => server.listen(PUBLIC_PORT, resolve))

  const ip = lanIPv4()
  const url = `exp://${ip ?? "localhost"}:${PUBLIC_PORT}`
  console.log(`\n=== Recording mode ===`)
  console.log(`In Expo Go: "Enter URL manually" -> ${url}`)
  console.log(`Confirm the app fully loads (icons, fonts, images), then come back here.\n`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await rl.question("Press Enter once the app loaded correctly on your phone... ")

  console.log(`\nStopping Metro. ${recorded.size} responses recorded. Switching to replay-only.\n`)
  mode = "replay"
  killTree(metro)

  console.log(`=== Replay mode (no Metro running) ===`)
  console.log(`On your phone: force-close the app, then reopen the same URL: ${url}`)
  console.log(`If it loads identically, the POC passes.\n`)

  await rl.question("Press Enter to exit... ")
  rl.close()
  server.close()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
