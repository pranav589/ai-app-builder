import { NO_SHADOW, SHADOWS } from "./constants"
import type { Shadow, Vals } from "./types"

/** "#abc" / "#aabbccdd" / "rgb(...)" -> "#aabbcc"; fully transparent -> "transparent". */
export function colorOf(css: string | undefined): string {
  const c = (css ?? "").trim()
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(c)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return "transparent"
    const hex = (n: string) => Number(n).toString(16).padStart(2, "0")
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
  }
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return c.slice(0, 7).toLowerCase()
  return "transparent"
}

export const px = (css: string | undefined) => Math.round(parseFloat(css ?? "") * 10) / 10 || 0

export const pick = <T extends string>(v: string | undefined, map: Record<string, T>, fallback: T): T => map[v ?? ""] ?? fallback

/** "rgba(0, 0, 0, 0.12) 0px 4px 8px 0px" -> { y: 4, blur: 8, opacity: .12 } */
export function parseShadow(css: string | undefined): Shadow {
  const m = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(css ?? "")
  if (!m) return NO_SHADOW
  return { opacity: m[1] === undefined ? 1 : Number(m[1]), y: Number(m[3]), blur: Number(m[4]) }
}

export const presetOf = (s: Shadow) =>
  s.opacity <= 0 ? "none" : Object.entries(SHADOWS).sort((a, b) => Math.abs(a[1].blur - s.blur) - Math.abs(b[1].blur - s.blur))[0][0]

export function initialValues(s: Record<string, string>): Vals {
  const side = (k: string) => `${px(s[k])}px`
  return {
    color: colorOf(s.color),
    backgroundColor: colorOf(s.backgroundColor),
    fontSize: side("fontSize"),
    fontWeight: String(Number(s.fontWeight) || 400),
    fontStyle: s.fontStyle === "italic" ? "italic" : "normal",
    textAlign: pick(s.textAlign, { left: "left", start: "left", center: "center", right: "right", end: "right", justify: "left" }, "left"),
    lineHeight: s.lineHeight && s.lineHeight !== "normal" ? side("lineHeight") : "",
    letterSpacing: side("letterSpacing"),
    textDecorationLine: /line-through/.test(s.textDecorationLine ?? "") ? "line-through" : /underline/.test(s.textDecorationLine ?? "") ? "underline" : "none",
    borderRadius: side("borderTopLeftRadius"),
    borderTopLeftRadius: side("borderTopLeftRadius"),
    borderTopRightRadius: side("borderTopRightRadius"),
    borderBottomRightRadius: side("borderBottomRightRadius"),
    borderBottomLeftRadius: side("borderBottomLeftRadius"),
    borderWidth: side("borderTopWidth"),
    borderStyle: pick(s.borderTopStyle, { dashed: "dashed", dotted: "dotted" }, "solid"),
    borderColor: px(s.borderTopWidth) > 0 ? colorOf(s.borderTopColor) : "#d4d4d8",
    opacity: String(s.opacity === undefined || s.opacity === "" ? 1 : Number(s.opacity)),
    width: side("width"),
    height: side("height"),
    gap: s.rowGap && s.rowGap !== "normal" ? side("rowGap") : s.columnGap && s.columnGap !== "normal" ? side("columnGap") : "",
    paddingTop: side("paddingTop"),
    paddingRight: side("paddingRight"),
    paddingBottom: side("paddingBottom"),
    paddingLeft: side("paddingLeft"),
    marginTop: side("marginTop"),
    marginRight: side("marginRight"),
    marginBottom: side("marginBottom"),
    marginLeft: side("marginLeft"),
    flexDirection: s.flexDirection?.startsWith("column") ? "column" : "row",
    flexWrap: s.flexWrap === "wrap" ? "wrap" : "nowrap",
    flexGrow: Number(s.flexGrow) > 0 ? "1" : "0",
    overflow: s.overflow === "hidden" ? "hidden" : "visible",
    justifyContent: pick(s.justifyContent, { "flex-start": "flex-start", start: "flex-start", center: "center", "flex-end": "flex-end", end: "flex-end", "space-between": "space-between", "space-around": "space-around" }, "flex-start"),
    alignItems: pick(s.alignItems, { "flex-start": "flex-start", start: "flex-start", center: "center", "flex-end": "flex-end", end: "flex-end", stretch: "stretch", normal: "stretch", baseline: "flex-start" }, "stretch"),
  }
}

export const tokenLabel = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())

/** A theme color as "#rrggbb", or null when it isn't a plain hex. */
export const themeHex = (v: string | undefined) => {
  const h = colorOf(v)
  return h === "transparent" ? null : h
}
