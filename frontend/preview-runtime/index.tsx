// Entry point of the preview runtime (bundled to public/preview/runtime.js by
// scripts/build-preview.mjs). Runs inside a sandboxed iframe and renders the
// generated Expo app with react-native-web.

import * as React from "react"
import { createRoot } from "react-dom/client"

import { post } from "./bridge"
import "./inspect"
import { RouterRoot } from "./router"

const css = `
html,body{height:100%;margin:0;overflow:hidden;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
#root{display:flex;flex-direction:column;height:100%;overflow:hidden}
.pv-stack{position:relative;flex:1;overflow:hidden}
.pv-layer{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden}
.pv-push{animation:pv-in .34s cubic-bezier(.32,.72,0,1) both;box-shadow:-12px 0 32px -12px rgba(0,0,0,.25)}
.pv-out{animation:pv-out .3s cubic-bezier(.32,.72,0,1) both;pointer-events:none}
.pv-modal{animation:pv-up .38s cubic-bezier(.32,.72,0,1) both}
.pv-modal-out{animation:pv-down .3s cubic-bezier(.32,.72,0,1) both;pointer-events:none}
.pv-fade{animation:pv-fade .2s ease-out both}
.pv-sheet{top:60px;border-radius:12px 12px 0 0;box-shadow:0 0 0 100vmax rgba(0,0,0,.32)}
.pv-sheet.pv-modal{animation:pv-up .38s cubic-bezier(.32,.72,0,1) both,pv-dim .38s ease-out both}
@keyframes pv-dim{from{box-shadow:0 0 0 100vmax rgba(0,0,0,0)}to{box-shadow:0 0 0 100vmax rgba(0,0,0,.32)}}
@keyframes pv-in{from{transform:translateX(100%)}to{transform:none}}
@keyframes pv-out{from{transform:none}to{transform:translateX(100%)}}
@keyframes pv-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes pv-down{from{transform:none}to{transform:translateY(100%)}}
@keyframes pv-fade{from{opacity:0}to{opacity:1}}
input,textarea{caret-color:auto}
::-webkit-scrollbar{display:none}
*{scrollbar-width:none}
`
const style = document.createElement("style")
style.textContent = css
document.head.appendChild(style)

window.addEventListener("error", (e) => post({ kind: "error", message: e.message }))
window.addEventListener("unhandledrejection", (e) => {
  const reason = (e as PromiseRejectionEvent).reason
  post({ kind: "error", message: reason instanceof Error ? reason.message : String(reason) })
})

createRoot(document.getElementById("root")!).render(<RouterRoot />)
post({ kind: "ready" })
