import { readFileSync } from "node:fs"
import { JSDOM } from "jsdom"
import { BRIDGE_TAG } from "../lib/preview/protocol"
import { compileForPreview, projectExports } from "../lib/app-project/project"
import { loadProject } from "../lib/agent/history"
import { readAppDoc, mergeScreensIntoFiles, plannedRoutesFromScreens } from "../lib/app-runtime/app-doc"

async function main() {
  const projectId = process.argv[2]
  const project = await loadProject(projectId)
  const doc = readAppDoc(project.previewScreens)

  // This is exactly what the OLD buggy code sent: doc.files alone, no screens merged in.
  const brokenFiles = doc.files ?? {}
  // This is the fix: screens merged in.
  const fixedFiles = mergeScreensIntoFiles(doc.files, doc.screens)

  console.log("broken files has app/product-list.tsx:", "app/product-list.tsx" in brokenFiles)
  console.log("fixed  files has app/product-list.tsx:", "app/product-list.tsx" in fixedFiles)

  for (const [label, files] of [["BROKEN", brokenFiles], ["FIXED", fixedFiles]] as const) {
    const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { runScripts: "dangerously", url: "http://localhost/" })
    const win = dom.window as any
    win.ResizeObserver = class { observe(){}; unobserve(){}; disconnect(){} }
    win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true} })
    win.reportError = (err: unknown) => win.dispatchEvent(new win.ErrorEvent("error", { message: String(err), error: err }))

    const ready = new Promise<void>((resolve) => {
      win.addEventListener("message", (e: any) => {
        const m = e.data
        if (m?.__app === BRIDGE_TAG && m.kind === "ready") resolve()
      })
    })
    win.__PREVIEW_CFG__ = { mode: "interactive", route: "/product-list", platform: "ios", appName: "StepDown" }
    const script = win.document.createElement("script")
    script.textContent = readFileSync("public/preview/runtime.js", "utf8")
    win.document.body.appendChild(script)
    await ready

    const exports = projectExports(files)
    const compiled: Record<string, string> = {}
    for (const [p, code] of Object.entries(files)) {
      try { compiled[p] = compileForPreview(p, code, exports) } catch {}
    }
    win.dispatchEvent(new win.MessageEvent("message", { data: { __app: BRIDGE_TAG, kind: "modules", modules: compiled, planned: plannedRoutesFromScreens(doc.screens) }, source: win }))
    win.dispatchEvent(new win.MessageEvent("message", { data: { __app: BRIDGE_TAG, kind: "data", data: { collections: {}, settings: {}, user: null, signedIn: false } }, source: win }))
    win.dispatchEvent(new win.MessageEvent("message", { data: { __app: BRIDGE_TAG, kind: "reset", route: "/product-list" }, source: win }))
    await new Promise((r) => setTimeout(r, 80))

    console.log(`\n--- ${label}: body text (first 300 chars) ---`)
    console.log(win.document.body.textContent?.slice(0, 300))
  }
  process.exit(0)
}
main().catch((e) => { console.error("FAILED", e); process.exit(1) })
