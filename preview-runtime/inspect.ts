// Hover/select of rendered elements for the inline editor. Every element
// carries data-eid="file:line:Type" (added by the module loader), which
// points back at the JSX that produced it.

import type { ElementEdit, SelectedElement } from "@/lib/preview/protocol"
import { isAppOwned } from "@/lib/verify/ownership"
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

// The element to select for a tap: the nearest one written in the app's own
// files. Kit internals (e.g. the <RNText> inside a kit <Button>) and
// compiler-owned layouts are skipped: their eid points at shared code, so
// editing it would change every use (or fail), not the thing tapped.
const eidFile = (el: Element) => (el.getAttribute("data-eid") ?? "").replace(/:\d+:[^:]+$/, "")
function target(e: Event): HTMLElement | null {
  let el = e.target instanceof Element ? e.target.closest("[data-eid]") : null
  while (el && !isAppOwned(eidFile(el))) el = el.parentElement?.closest("[data-eid]") ?? null
  return el as HTMLElement | null
}

// Where the editable text sits inside the selected element, as child
// indices: [] for the element itself, or the path to a kit component's
// tapped label. Paths survive re-renders, element references don't.
let textPath: number[] | null = null

function textPathFor(el: HTMLElement, tapped: Element | null): number[] | null {
  if (el.children.length === 0) return el.textContent?.trim() ? [] : null
  // A kit component renders its text props (label, title...) itself: the
  // tapped leaf is the one to edit, matched back to the prop by its text.
  if (el.dataset.kit !== "1" || !tapped || !el.contains(tapped)) return null
  let leaf: Element | null = tapped
  while (leaf && leaf !== el && (leaf.children.length > 0 || !leaf.textContent?.trim())) leaf = leaf.parentElement
  if (!leaf || leaf === el) return null
  const path: number[] = []
  for (let n: Element = leaf; n !== el; n = n.parentElement!) path.unshift(Array.prototype.indexOf.call(n.parentElement!.children, n))
  return path
}

function atPath(el: Element, path: number[]): Element | null {
  let n: Element | null = el
  for (const i of path) n = n?.children[i] ?? null
  return n
}

function describe(el: HTMLElement, tapped: Element | null): SelectedElement {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const eid = el.dataset.eid ?? ""
  textPath = textPathFor(el, tapped)
  return {
    eid,
    tag: eid.split(":").pop() ?? el.tagName.toLowerCase(),
    text: textPath ? (atPath(el, textPath)?.textContent ?? null) : null,
    kit: el.dataset.kit === "1",
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
      post({ kind: "select", element: describe(el, e.target instanceof Element ? e.target : null) })
    },
    true
  )
}

handlers.inspect = (on) => {
  inspecting = on
  document.documentElement.style.cursor = on ? "default" : ""
  if (!on) {
    selected = null
    textPath = null
    place(hoverBox(), null)
    place(selectBox(), null)
  }
}

// Every element from the same source line gets the edit (e.g. each row of a
// list): that's what the saved source change will do too.
const cssName = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
handlers.applyEdit = (edit: ElementEdit) => {
  const els = document.querySelectorAll<HTMLElement>(`[data-eid="${CSS.escape(edit.eid)}"]`)
  if (!els.length) return
  if (selected && !selected.isConnected) selected = els[0]
  for (const el of els) {
    if (typeof edit.text === "string" && textPath) {
      const t = atPath(el, textPath)
      if (t) t.textContent = edit.text
    }
    if (edit.style) for (const [k, v] of Object.entries(edit.style)) el.style.setProperty(cssName(k), v)
  }
  if (selected) place(selectBox(), selected)
}
