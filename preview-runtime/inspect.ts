// Hover/select of rendered elements for the inline editor. Every element
// carries data-eid="file:line:Type" (added by the module loader), which
// points back at the JSX that produced it.

import type { ElementEdit, SelectedElement } from "@/lib/preview/protocol"
import { handlers, post } from "./bridge"

let inspecting = false
let selected: HTMLElement | null = null

function box(id: string, css: string) {
  let b = document.getElementById(id)
  if (!b) {
    b = document.createElement("div")
    b.id = id
    b.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;display:none;border-radius:3px;${css}`
    document.body.appendChild(b)
  }
  return b
}
const hoverBox = () => box("__pv-hover", "outline:1.5px dashed #3b82f6;background:rgba(59,130,246,.06)")
const selectBox = () => box("__pv-select", "outline:2px solid #3b82f6")

function place(b: HTMLElement, el: HTMLElement | null) {
  if (!el || !el.isConnected) {
    b.style.display = "none"
    return
  }
  const r = el.getBoundingClientRect()
  Object.assign(b.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
}

const target = (e: Event) => (e.target instanceof Element ? (e.target.closest("[data-eid]") as HTMLElement | null) : null)

function describe(el: HTMLElement): SelectedElement {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const eid = el.dataset.eid ?? ""
  return {
    eid,
    tag: eid.split(":").pop() ?? el.tagName.toLowerCase(),
    text: el.children.length === 0 ? el.textContent : null,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    styles: {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      margin: cs.margin,
    },
  }
}

document.addEventListener(
  "mousemove",
  (e) => {
    if (!inspecting) return
    const el = target(e)
    place(hoverBox(), el && el !== selected ? el : null)
  },
  true
)

// Capture phase: while inspecting, taps select instead of reaching the app.
for (const type of ["click", "pointerdown", "pointerup", "mousedown", "mouseup"] as const) {
  document.addEventListener(
    type,
    (e) => {
      if (!inspecting) return
      e.preventDefault()
      e.stopPropagation()
      if (type !== "click") return
      const el = target(e)
      if (!el) return
      selected = el
      place(selectBox(), el)
      place(hoverBox(), null)
      post({ kind: "select", element: describe(el) })
    },
    true
  )
}

handlers.inspect = (on) => {
  inspecting = on
  document.documentElement.style.cursor = on ? "default" : ""
  if (!on) {
    selected = null
    place(hoverBox(), null)
    place(selectBox(), null)
  }
}

handlers.applyEdit = (edit: ElementEdit) => {
  const el = document.querySelector<HTMLElement>(`[data-eid="${CSS.escape(edit.eid)}"]`)
  if (!el) return
  if (typeof edit.text === "string") el.textContent = edit.text
  if (edit.style) for (const [k, v] of Object.entries(edit.style)) el.style.setProperty(k, v)
  if (el === selected) place(selectBox(), el)
}
