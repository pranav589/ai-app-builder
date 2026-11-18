// A canvas element the creator selected and attached to a chat message
// ("make this button blue"). The browser sends a small reference; this turns
// it into words the router and coder can act on, and keeps what's stored
// bounded and safe, since it comes from the client.

import type { ElementRef } from "@/lib/preview/protocol"

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined)

/** A trusted ElementRef from untrusted input, or undefined when it isn't one. */
export function parseElementRef(v: unknown): ElementRef | undefined {
  if (!v || typeof v !== "object") return undefined
  const o = v as Record<string, unknown>
  const eid = clip(o.eid, 300)
  const tag = clip(o.tag, 60)
  if (!eid || !tag || !/^.+:\d+:[^:]+$/.test(eid)) return undefined
  return {
    eid,
    tag,
    text: clip(o.text, 200) ?? null,
    screenId: clip(o.screenId, 80),
    screenName: clip(o.screenName, 80),
  }
}

export const elementFile = (el: ElementRef) => el.eid.replace(/:\d+:[^:]+$/, "")
const elementLine = (el: ElementRef) => Number(/:(\d+):[^:]+$/.exec(el.eid)?.[1] ?? 0)

/** Short label for the chat: `Button "Save"`. */
export const elementLabel = (el: ElementRef) => (el.text ? `${el.tag} “${el.text.length > 28 ? `${el.text.slice(0, 27)}…` : el.text}”` : el.tag)

/** What the model is told so "this button" / "it" means the selected element. */
export function describeElement(el: ElementRef): string {
  const where = `${elementFile(el)}, line ${elementLine(el)}`
  const shows = el.text ? `, showing the text "${el.text}"` : ""
  const screen = el.screenName ? ` on the "${el.screenName}" screen` : ""
  return `[The person selected a <${el.tag}> element${screen} (JSX at ${where}${shows}) and attached it to this message. "This", "it", "this button" and similar words refer to that element: change that element, find it at that line, and leave everything else as it is.]`
}
