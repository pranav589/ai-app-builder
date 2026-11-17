import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { parseReply } from "../agent/protocol"
import type { RunReport } from "../agent/run"
import { applyChangeSet, loadFixture, POC_ROOT, type Workspace } from "../core/workspace"
import { previewHtml } from "../preview/build"
import { checkout, head } from "../store/snapshots"

// npm run preview                         HEAD -> .data/preview/app.html
// npm run preview -- --eval <log.json>    every committed eval result -> .data/preview/<log>/index.html

const OUT = path.join(POC_ROOT, ".data", "preview")
const args = process.argv.slice(2)
const evalIdx = args.indexOf("--eval")
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The screen a change is about, with sample params, so its preview opens there. */
function focusOf(ws: Workspace, changed: string[]) {
  const screenFile = changed.find((p) => p.startsWith("screens/"))
  const id = screenFile?.slice("screens/".length, -".tsx".length)
  const meta = id ? ws.manifest.screens[id] : undefined
  if (!id || !meta) return ""
  const params = Object.entries(meta.params ?? {}).map(([k, t]) => {
    const ref = /^ref:(.+)$/.exec(t)?.[1]
    const seed = ref ? ws.manifest.entities[ref]?.seed[0] : undefined
    return [k, ref ? String(seed?.id ?? `${ref.toLowerCase()}-1`) : t === "number" ? 1 : "sample"]
  })
  return `#screen=${id}${params.length ? `&params=${encodeURIComponent(JSON.stringify(Object.fromEntries(params)))}` : ""}`
}

mkdirSync(OUT, { recursive: true })

if (evalIdx < 0) {
  const id = head()
  if (!id) {
    console.error("No snapshots yet. Run: npm run init")
    process.exit(1)
  }
  const file = path.join(OUT, "app.html")
  writeFileSync(file, await previewHtml(checkout(id), `Snapshot ${id}`))
  console.log(`Preview of HEAD ${id}: ${file}`)
  process.exit(0)
}

const logFile = path.resolve(args[evalIdx + 1])
const rows = JSON.parse(readFileSync(logFile, "utf8")) as (RunReport & { task: number; category: string })[]
const dir = path.join(OUT, path.basename(logFile, ".json"))
mkdirSync(dir, { recursive: true })
const base = loadFixture()
writeFileSync(path.join(dir, "base.html"), await previewHtml(base, "Base app"))

const cards: string[] = []
for (const r of rows.sort((a, b) => a.task - b.task)) {
  const last = r.attempts[r.attempts.length - 1]
  const ok = r.state === "committed" && last?.ok
  const fails = r.attempts.filter((a) => !a.ok).map((a) => `${a.failedAt ?? "question"}: ${(a.diagnostics ?? a.legacyProblems?.join("; ") ?? "").split("\n")[0]}`)
  let frame = `<div class="none">Not committed: ${esc(r.question ?? "still failing after the repair budget")}</div>`
  if (ok) {
    const applied = applyChangeSet(base, parseReply(last.raw).changeSet)
    if (applied.ws) {
      const name = `task-${String(r.task).padStart(2, "0")}.html`
      writeFileSync(path.join(dir, name), await previewHtml(applied.ws, `Task ${r.task}`))
      frame = `<iframe src="${name}${focusOf(applied.ws, applied.changed)}" title="Task ${r.task}" loading="lazy"></iframe>`
    }
  }
  cards.push(`<article>
  <header><b>#${r.task}</b> <span class="cat">${esc(r.category)}</span> <span class="${ok ? "ok" : "bad"}">${ok ? "verified" : r.state}</span>
  <span class="meta">${r.attempts.length} attempt(s) · ${(r.totalMs / 1000).toFixed(1)}s</span></header>
  <p>${esc(r.request)}</p>
  ${fails.length ? `<details><summary>${fails.length} rejected attempt(s)</summary><ul>${fails.map((f) => `<li>${esc(f.slice(0, 300))}</li>`).join("")}</ul></details>` : ""}
  ${frame}
</article>`)
  process.stdout.write(".")
}

writeFileSync(
  path.join(dir, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval previews · ${esc(rows[0]?.model ?? "")}</title>
<style>
  body { margin: 0; padding: 24px 16px; font: 14px/1.5 system-ui, sans-serif; background: #eef0ec; color: #17201b; }
  h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #5a6660; margin: 0 0 20px; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
  article { background: #fff; border: 1px solid #d5dbd5; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } p { margin: 0; }
  .cat { font: 12px ui-monospace, monospace; color: #5a6660; } .meta { color: #5a6660; margin-left: auto; }
  .ok { color: #1f8a5b; font-weight: 600; } .bad { color: #b3322b; font-weight: 600; }
  details { font-size: 12.5px; color: #5a6660; } details ul { margin: 6px 0 0; padding-left: 18px; }
  iframe { width: 100%; height: 640px; border: 1px solid #d5dbd5; border-radius: 8px; background: #fff; }
  .none { height: 120px; display: grid; place-items: center; color: #b3322b; border: 1px dashed #d5dbd5; border-radius: 8px; padding: 12px; text-align: center; }
  a { color: #2f6b4f; }
</style></head><body>
<h1>Eval previews</h1>
<p class="sub">Model ${esc(rows[0]?.model ?? "")} · each phone is the verified result of one request, opened on the screen it changed. Tap through it. <a href="base.html" target="_blank">Base app</a></p>
<main>
${cards.join("\n")}
</main></body></html>
`
)
console.log(`\nGallery: ${path.join(dir, "index.html")}`)
process.exit(0)
