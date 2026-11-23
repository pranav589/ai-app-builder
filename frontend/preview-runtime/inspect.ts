// Hover/select of rendered elements for the inline editor. Every element
// carries data-eid="file:line:Type" (added by the module loader), which
// points back at the JSX that produced it.

import type { ElementEdit, SelectedElement } from "@app/shared/preview/protocol"
import { isAppOwned } from "@app/shared/verify/ownership"
import { elementName } from "@app/shared/preview/element-names"
import { handlers, post } from "./bridge"

let inspecting = false
let selected: HTMLElement | null = null

function box(id: string, css: string, labelCss: string) {
  let b = document.getElementById(id)
  if (!b) {
    b = document.createElement("div")
    b.id = id
    b.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;display:none;border-radius:3px;${css}`
    const label = document.createElement("span")
    label.style.cssText = `position:absolute;left:-1px;white-space:nowrap;font:600 10px/16px -apple-system,system-ui,sans-serif;padding:0 5px;border-radius:3px;color:#fff;${labelCss}`
    b.appendChild(label)
    document.body.appendChild(b)
  }
  return b
}
const hoverBox = () => box("__pv-hover", "outline:1.5px dashed #8b5cf6;background:rgba(139,92,246,.06)", "background:#8b5cf6;opacity:.85")
const selectBox = () => box("__pv-select", "outline:2px solid #7c3aed", "background:#7c3aed")

function place(b: HTMLElement, el: HTMLElement | null) {
  if (!el || !el.isConnected) {
    b.style.display = "none"
    return
  }
  const r = el.getBoundingClientRect()
  Object.assign(b.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  // The element's plain name sits on its top edge (inside it, when there's no room above).
  const label = b.firstElementChild as HTMLElement | null
  if (label) {
    label.textContent = elementName(eidTag(el))
    label.style.top = r.top < 18 ? "0px" : "-17px"
  }
}
const eidTag = (el: Element) => (el.getAttribute("data-eid") ?? "").split(":").pop() ?? el.tagName.toLowerCase()

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

// The editable element around `el`: the next one up written in the app's own
// files, and not another rendering of the same source line.
function parentOf(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement?.closest("[data-eid]") ?? null
  while (p && (!isAppOwned(eidFile(p)) || p.getAttribute("data-eid") === el.getAttribute("data-eid"))) p = p.parentElement?.closest("[data-eid]") ?? null
  return p as HTMLElement | null
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

function extractImageSrc(el: HTMLElement, tapped: Element | null): string | null {
  if (tapped instanceof HTMLImageElement && (tapped.currentSrc || tapped.src)) {
    return tapped.currentSrc || tapped.src
  }
  const tappedImg = tapped?.querySelector("img")
  if (tappedImg && (tappedImg.currentSrc || tappedImg.src)) {
    return tappedImg.currentSrc || tappedImg.src
  }
  if (el instanceof HTMLImageElement && (el.currentSrc || el.src)) {
    return el.currentSrc || el.src
  }
  const elImg = el.querySelector("img")
  if (elImg && (elImg.currentSrc || elImg.src)) {
    return elImg.currentSrc || elImg.src
  }
  const cs = getComputedStyle(el)
  const bg = cs.backgroundImage || el.style.backgroundImage
  if (bg && bg !== "none") {
    const m = /url\(["']?([^"']+)["']?\)/.exec(bg)
    if (m) return m[1]
  }
  return null
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
    styles: Object.fromEntries(READ_STYLES.map((k) => [k, (cs as unknown as Record<string, string>)[k]])),
    parent: (() => {
      const p = parentOf(el)
      return p ? eidTag(p) : null
    })(),
    imageSrc: extractImageSrc(el, tapped),
  }
}

// What the editor shows for an element: its computed style, as the app renders it now.
const READ_STYLES = [
  "color", "backgroundColor", "fontSize", "fontWeight", "fontStyle", "textAlign", "lineHeight", "letterSpacing", "textDecorationLine",
  "borderRadius", "borderTopWidth", "borderTopColor", "borderTopStyle", "opacity", "width", "height", "gap",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "flexDirection", "justifyContent", "alignItems", "display", "flexWrap", "alignSelf", "flexGrow", "overflow", "boxShadow",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius", "borderTopStyle",
  "rowGap", "columnGap",
]

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
      if (!el) {
        clearSelection()
        post({ kind: "deselect" })
        return
      }
      selected = el
      place(selectBox(), el)
      place(hoverBox(), null)
      post({ kind: "select", element: describe(el, e.target instanceof Element ? e.target : null) })
    },
    true
  )
}

function clearSelection() {
  selected = null
  textPath = null
  place(hoverBox(), null)
  place(selectBox(), null)
}

handlers.inspect = (on) => {
  inspecting = on
  document.documentElement.style.cursor = on ? "default" : ""
  if (!on) clearSelection()
}
handlers.deselect = clearSelection
handlers.selectParent = () => {
  const p = selected && parentOf(selected)
  if (!p) return
  selected = p
  textPath = textPathFor(p, null)
  place(selectBox(), p)
  post({ kind: "select", element: describe(p, null) })
}

// The host's popover follows the element: tell it where the element is now.
let rectFrame = 0
function reportRect() {
  if (rectFrame) return
  rectFrame = requestAnimationFrame(() => {
    rectFrame = 0
    if (!selected || !selected.isConnected) return
    place(selectBox(), selected)
    const r = selected.getBoundingClientRect()
    post({ kind: "element-rect", eid: selected.dataset.eid ?? "", rect: { x: r.left, y: r.top, width: r.width, height: r.height } })
  })
}
document.addEventListener("scroll", () => selected && reportRect(), true)

// Every element from the same source line gets the edit (e.g. each row of a
// list): that's what the saved source change will do too.
const cssName = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
// React Native style -> what the DOM preview needs. Theme colors arrive as
// "theme:<token>:<hex>" (the hex is what shows now); shadows are several RN
// props that react-native-web turns into one box-shadow.
const RN_ONLY = new Set(["shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius", "elevation"])

function domStyle(style: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(style)) {
    if (RN_ONLY.has(k)) continue
    const tok = /^theme:[A-Za-z]+:(#[0-9a-fA-F]{3,8})$/.exec(raw)
    out[cssName(k)] = tok ? tok[1] : raw
  }
  if (["shadowOpacity", "shadowRadius", "shadowOffset"].some((k) => k in style)) {
    const [x = "0", y = "0"] = (style.shadowOffset ?? "0,0").split(",")
    const opacity = Number(style.shadowOpacity ?? 0)
    out["box-shadow"] = opacity > 0 ? `${Number(x) || 0}px ${Number(y) || 0}px ${Number(style.shadowRadius) || 0}px rgba(0,0,0,${opacity})` : "none"
  }
  return out
}

handlers.applyEdit = (edit: ElementEdit) => {
  const els = document.querySelectorAll<HTMLElement>(`[data-eid="${CSS.escape(edit.eid)}"]`)
  if (!els.length) return
  if (selected && !selected.isConnected) selected = els[0]
  const css = edit.style ? domStyle(edit.style) : null
  for (const el of els) {
    if (typeof edit.text === "string" && textPath) {
      const t = atPath(el, textPath)
      if (t) t.textContent = edit.text
    }
    if (typeof edit.imageSrc === "string") {
      const img = el.tagName === "IMG" ? (el as HTMLImageElement) : el.querySelector("img")
      if (img) {
        img.src = edit.imageSrc
      } else {
        el.style.backgroundImage = `url("${edit.imageSrc}")`
      }
    }
    if (css) for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v)
  }
  if (selected) reportRect()
}
