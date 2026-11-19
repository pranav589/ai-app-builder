"use client"

import * as React from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUp,
  Bold,
  Box,
  Check,
  Code2,
  Image as ImageIcon,
  Italic,
  LayoutPanelLeft,
  Loader2,
  MousePointerClick,
  Palette,
  RefreshCw,
  RotateCcw,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Square,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  Upload,
  Wand2,
  X,
  Move,
  Layers,
} from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiClient } from "@/lib/api-client"
import { THEME_COLOR_KEYS, type ThemeColorKey } from "@/lib/app-runtime/theme"
import { elementKind, elementName, type ElementKind } from "@/lib/preview/element-names"
import type { ElementEdit, SelectedElement } from "@/lib/preview/protocol"
import { useAppTheme } from "./app-runtime"

// ---------------------------------------------------------------- values

/** Every style value is held as the CSS string it was read as / will be sent as. */
type Vals = Record<string, string>

const HEX6 = /^#[0-9a-f]{6}$/i

/** "#abc" / "#aabbccdd" / "rgb(...)" -> "#aabbcc"; fully transparent -> "transparent". */
function colorOf(css: string | undefined): string {
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

const px = (css: string | undefined) => Math.round(parseFloat(css ?? "") * 10) / 10 || 0
const pick = <T extends string>(v: string | undefined, map: Record<string, T>, fallback: T): T => map[v ?? ""] ?? fallback

type Shadow = { y: number; blur: number; opacity: number }
const SHADOWS: Record<string, Shadow> = {
  small: { y: 1, blur: 3, opacity: 0.08 },
  medium: { y: 4, blur: 8, opacity: 0.12 },
  large: { y: 10, blur: 20, opacity: 0.18 },
}
const NO_SHADOW: Shadow = { y: 0, blur: 0, opacity: 0 }

/** "rgba(0, 0, 0, 0.12) 0px 4px 8px 0px" -> { y: 4, blur: 8, opacity: .12 } */
function parseShadow(css: string | undefined): Shadow {
  const m = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(css ?? "")
  if (!m) return NO_SHADOW
  return { opacity: m[1] === undefined ? 1 : Number(m[1]), y: Number(m[3]), blur: Number(m[4]) }
}
const presetOf = (s: Shadow) =>
  s.opacity <= 0 ? "none" : Object.entries(SHADOWS).sort((a, b) => Math.abs(a[1].blur - s.blur) - Math.abs(b[1].blur - s.blur))[0][0]

function initialValues(s: Record<string, string>): Vals {
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

const SHADOW_KEYS = ["shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius", "elevation"]
const tokenLabel = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())

/** A theme color as "#rrggbb", or null when it isn't a plain hex. */
const themeHex = (v: string | undefined) => {
  const h = colorOf(v)
  return h === "transparent" ? null : h
}

// ---------------------------------------------------------------- controls

function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-9 items-center justify-between gap-3 py-0.5", className)}>
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  )
}

function NumberBox({ label, value, onChange, min = 0, max = 999, step = 1, suffix, placeholder, className }: { label: string; value: number | null; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative w-[116px]", className)}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value === null ? "" : value}
        placeholder={placeholder ?? "0"}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === "") return
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
        className={cn(
          "h-9 w-full rounded-(--r-md) border border-input bg-background px-2 text-center text-sm tabular-nums outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          suffix && "pr-6"
        )}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  )
}

type Option = { value: string; label?: string; icon?: React.ComponentType<{ className?: string }>; title?: string }

function Segmented({ label, value, options, onChange, className }: { label: string; value: string; options: Option[]; onChange: (v: string) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex rounded-(--r-md) bg-muted p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title ?? o.label ?? o.value}
          title={o.title ?? o.label}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center justify-center rounded-[calc(var(--r-md)-2px)] px-2 text-xs font-medium transition-colors",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.icon ? <o.icon className="size-3.5" /> : <span className="truncate">{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

function Toggle({ pressed, label, icon: Icon, onClick }: { pressed: boolean; label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <Button type="button" variant={pressed ? "secondary" : "ghost"} size="icon-sm" aria-pressed={pressed} aria-label={label} title={label} onClick={onClick}>
      <Icon />
    </Button>
  )
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="py-3 first:pt-0 last:pb-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border">
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  )
}

const checker = { backgroundImage: "linear-gradient(45deg,#d4d4d8 25%,transparent 25%,transparent 75%,#d4d4d8 75%),linear-gradient(45deg,#d4d4d8 25%,#fff 25%,#fff 75%,#d4d4d8 75%)", backgroundSize: "8px 8px", backgroundPosition: "0 0,4px 4px" }

/** A color property: a chip that opens the theme palette, a custom hex, or "None". */
function ColorRow({
  label,
  hex,
  token,
  allowNone,
  onPick,
}: {
  label: string
  hex: string
  /** The theme token this color was picked as, when it was. */
  token?: string
  allowNone?: boolean
  onPick: (choice: { hex: string; token?: ThemeColorKey }) => void
}) {
  const theme = useAppTheme()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(hex)
  React.useEffect(() => setDraft(hex === "transparent" ? "" : hex), [hex])

  const palette = React.useMemo(
    () =>
      THEME_COLOR_KEYS.map((k) => ({ key: k, hex: themeHex(theme?.colors[k]) })).filter((c): c is { key: ThemeColorKey; hex: string } => !!c.hex),
    [theme]
  )
  const matched = token ?? palette.find((c) => c.hex === hex)?.key
  const name = hex === "transparent" ? "None" : matched ? tokenLabel(matched) : hex.toUpperCase()

  return (
    <div>
      <Row label={label}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${label}: ${name}`}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex h-9 w-[132px] items-center gap-2 rounded-(--r-md) border bg-background px-2 text-sm transition-colors hover:border-foreground/25",
            open ? "border-primary ring-2 ring-primary/20" : "border-input"
          )}
        >
          <span className="size-5 shrink-0 rounded-md border border-black/10" style={hex === "transparent" ? checker : { background: hex }} />
          <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        </button>
      </Row>
      {open && (
        <div className="mt-1 mb-2 space-y-3 rounded-(--r-md) border border-border bg-muted/40 p-3 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {palette.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium">Theme colors</p>
              <div className="grid grid-cols-7 gap-1.5">
                {palette.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    title={tokenLabel(c.key)}
                    aria-label={tokenLabel(c.key)}
                    aria-pressed={matched === c.key && hex === c.hex}
                    onClick={() => onPick({ hex: c.hex, token: c.key })}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg border border-black/10 transition-transform hover:scale-105",
                      matched === c.key && hex === c.hex && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    )}
                    style={{ background: c.hex }}
                  >
                    {matched === c.key && hex === c.hex && <Check className="size-3.5 text-white mix-blend-difference" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-(--r-md) border border-black/10" style={hex === "transparent" ? checker : { background: hex }}>
              <input
                type="color"
                aria-label={`${label}: custom color`}
                value={hex === "transparent" ? "#ffffff" : hex}
                onChange={(e) => onPick({ hex: e.target.value.toLowerCase() })}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
            <Input
              value={draft}
              placeholder="#000000"
              aria-label={`${label}: hex value`}
              onChange={(e) => {
                const v = e.target.value.startsWith("#") || !e.target.value ? e.target.value : `#${e.target.value}`
                setDraft(v)
                if (HEX6.test(v)) onPick({ hex: v.toLowerCase() })
              }}
              className="h-9 flex-1 font-mono text-sm uppercase"
            />
            {allowNone && (
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => onPick({ hex: "transparent" })}>
                None
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Theme colors follow the app&apos;s theme. Custom colors stay the same when the theme changes.</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the editor

type TabId = "image" | "text" | "colors" | "spacing" | "layout" | "border" | "effects"
const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "text", label: "Text", icon: Type },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "spacing", label: "Spacing", icon: Move },
  { id: "layout", label: "Layout", icon: LayoutPanelLeft },
  { id: "border", label: "Border", icon: Square },
  { id: "effects", label: "Effects", icon: Layers },
]

const KIND_ICON: Record<ElementKind, React.ComponentType<{ className?: string }>> = {
  container: Box,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  icon: Shapes,
  input: TextCursorInput,
  other: Box,
}

const SUGGESTIONS = ["Make it bigger", "Use the primary color", "Add more breathing room", "Round the corners"]

const TRANSFORM_PRESETS = [
  { label: "🪄 Remove BG", prompt: "remove background" },
  { label: "🌆 Sunset Skyline", prompt: "change background to sunset city skyline" },
  { label: "☕ Cozy Cafe", prompt: "change background to cozy cafe with warm lighting" },
  { label: "🌿 Wooden Studio", prompt: "change background to wooden table with soft studio lighting" },
  { label: "👥 Drop Shadow", prompt: "add drop shadow" },
  { label: "📐 Generative Fill", prompt: "expand canvas with generative fill" },
  { label: "⚡ AI Upscale", prompt: "ai upscale and enhance" },
  { label: "🖤 Black & White", prompt: "make it black and white" },
]

const GENERATE_STYLES = [
  { id: "photo", label: "Photorealistic" },
  { id: "minimal3d", label: "Minimalist 3D" },
  { id: "illustration", label: "Illustration" },
  { id: "isometric", label: "Isometric" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "watercolor", label: "Watercolor" },
]

const QUICK_REPLACE_PRESETS = [
  { name: "Sample Product", url: "https://ik.imagekit.io/demo/img/default-image.jpg" },
  { name: "User Avatar", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80" },
  { name: "Coffee & Food", url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500&auto=format&fit=crop&q=80" },
  { name: "Tech Minimal", url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=500&auto=format&fit=crop&q=80" },
]

type PendingEdit = { text?: string; style?: Record<string, string>; imageSrc?: string }
type SaveResult = { ok: boolean; error?: string; resynced?: boolean; aborted?: boolean }
type SizeMode = "auto" | "fill" | "fixed"

/**
 * The inline editor's popover: Colors, Spacing, Layout, Border and Effects
 * (plus Text for text), one tab at a time, or every section in one list in
 * Advanced. Every change shows in the screen immediately (`onPreview`) and is
 * saved a moment later through the change gateway (`onSave`): no model call.
 */
export function ElementEditor({
  element,
  screenName,
  advanced,
  onAdvancedChange,
  onClose,
  onSelectParent,
  onPreview,
  onSave,
  onViewCode,
  onAskAI,
  disabledAI,
}: {
  element: SelectedElement
  screenName?: string
  advanced: boolean
  onAdvancedChange: (advanced: boolean) => void
  onClose: () => void
  onSelectParent: () => void
  onPreview: (edit: ElementEdit) => void
  onSave: (edit: ElementEdit, signal?: AbortSignal) => Promise<SaveResult>
  onViewCode: () => void
  /** Sends an instruction about this element to the AI (through the chat). */
  onAskAI: (instruction: string) => void
  disabledAI?: boolean
}) {
  const theme = useAppTheme()
  const eid = element.eid
  const kind = elementKind(element.tag)
  const isImage = kind === "image" || Boolean(element.imageSrc)
  const canEditText = element.text !== null
  const canEditStyle = !element.kit
  const isFlex = element.styles.display === "flex"

  const orig = React.useRef<Vals>(initialValues(element.styles))
  const origText = React.useRef(element.text ?? "")
  const origImage = React.useRef<string>(element.imageSrc ?? "")
  const origShadow = React.useRef(parseShadow(element.styles.boxShadow))
  const [text, setText] = React.useState(origText.current)
  const [vals, setVals] = React.useState<Vals>(orig.current)
  /** Which theme token each color was picked as, so the chip can name it. */
  const [tokens, setTokens] = React.useState<Record<string, string | undefined>>({})
  const [shadow, setShadow] = React.useState<Shadow>(origShadow.current)
  const [sizeMode, setSizeMode] = React.useState<{ width: SizeMode; height: SizeMode }>({ width: "auto", height: "auto" })
  const [cornersEach, setCornersEach] = React.useState(() => new Set([orig.current.borderTopLeftRadius, orig.current.borderTopRightRadius, orig.current.borderBottomRightRadius, orig.current.borderBottomLeftRadius]).size > 1)
  const tabs = TABS.filter((t) => (t.id === "image" ? isImage : t.id === "text" ? canEditText : canEditStyle))
  const [tab, setTab] = React.useState<TabId>(() => (isImage ? "image" : canEditText ? "text" : "colors"))
  const [aiOpen, setAiOpen] = React.useState(false)
  const [aiText, setAiText] = React.useState("")
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)

  // ImageKit states
  const [currentImage, setCurrentImage] = React.useState<string>(element.imageSrc ?? "")
  const [imageMode, setImageMode] = React.useState<"transform" | "generate" | "replace">("transform")
  const [transformPrompt, setTransformPrompt] = React.useState("")
  const [generatePrompt, setGeneratePrompt] = React.useState("")
  const [generateStyle, setGenerateStyle] = React.useState("photo")
  const [replaceUrl, setReplaceUrl] = React.useState("")
  const [imageLoading, setImageLoading] = React.useState(false)
  const [imageError, setImageError] = React.useState<string | null>(null)
  const [imageSuccess, setImageSuccess] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const imageTouched = React.useRef(false)

  const pending = React.useRef<PendingEdit>({})
  // The text as it is in the source right now: sent with a text edit so the
  // server edits exactly that text (and refuses rather than guess).
  const savedText = React.useRef<string | undefined>(element.text ?? undefined)
  // Text carried by a save that was abandoned: it may have landed anyway, so the server may also see it as the current text.
  const abandonedText = React.useRef<string | undefined>(undefined)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The save request in flight, with what it carries. At most one at a time. */
  const inflight = React.useRef<{ ctrl: AbortController; edit: PendingEdit } | null>(null)
  const touched = React.useRef(new Set<string>())
  const textTouched = React.useRef(false)

  /** Cancels the save in flight and puts what it carried back in front of what's pending, so one newer request covers both. */
  const takeBackInflight = React.useCallback(() => {
    const f = inflight.current
    if (!f) return
    inflight.current = null
    f.ctrl.abort()
    if (f.edit.text !== undefined) abandonedText.current = f.edit.text
    pending.current = {
      text: pending.current.text ?? f.edit.text,
      style: { ...f.edit.style, ...pending.current.style },
      imageSrc: pending.current.imageSrc ?? f.edit.imageSrc,
    }
  }, [])

  const flush = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    takeBackInflight()
    const edit = pending.current
    const hasStyle = !!edit.style && Object.keys(edit.style).length > 0
    const hasImage = edit.imageSrc !== undefined
    if (edit.text === undefined && !hasStyle && !hasImage) return
    pending.current = {}
    const ctrl = new AbortController()
    const mine = { ctrl, edit }
    inflight.current = mine
    setSaveState("saving")
    setError(null)
    const sentText = edit.text
    void onSave(
      {
        eid,
        text: sentText,
        from: sentText !== undefined ? savedText.current : undefined,
        fromAlt: sentText !== undefined ? abandonedText.current : undefined,
        style: hasStyle ? edit.style : undefined,
        imageSrc: edit.imageSrc,
      },
      ctrl.signal
    ).then((r) => {
      // Replaced by a newer request: its result is the one that counts.
      if (inflight.current !== mine) return
      inflight.current = null
      if (r.ok) {
        if (sentText !== undefined) {
          savedText.current = sentText
          abandonedText.current = undefined
        }
        setSaveState("saved")
      } else if (!r.aborted) {
        // Keep what failed, so the next change retries it together with its own.
        pending.current = {
          text: pending.current.text ?? edit.text,
          style: { ...edit.style, ...pending.current.style },
          imageSrc: pending.current.imageSrc ?? edit.imageSrc,
        }
        setSaveState("error")
        setError(r.error ?? "Couldn't save that change.")
      }
    })
  }, [eid, onSave, takeBackInflight])

  const apply = React.useCallback(
    (edit: PendingEdit) => {
      onPreview({ eid, ...edit })
      // A save still in flight is out of date the moment another change is made:
      // cancel it now and send everything together shortly.
      takeBackInflight()
      pending.current = {
        text: edit.text ?? pending.current.text,
        style: { ...pending.current.style, ...edit.style },
        imageSrc: edit.imageSrc ?? pending.current.imageSrc,
      }
      setSaveState("saving")
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 400)
    },
    [eid, onPreview, flush, takeBackInflight]
  )
  // Whatever is still waiting is saved when the editor closes or moves to another element.
  React.useEffect(() => () => flush(), [flush])

  const applyImageSrc = React.useCallback(
    (newUrl: string) => {
      setCurrentImage(newUrl)
      imageTouched.current = true
      setDirty(true)
      onPreview({ eid, imageSrc: newUrl })
      apply({ imageSrc: newUrl })
      setImageSuccess("Image updated!")
      setTimeout(() => setImageSuccess(null), 3000)
    },
    [eid, onPreview, apply]
  )

  /** Sets style properties: shown now, saved shortly. Values may be "theme:<token>:<hex>". */
  const set = (style: Record<string, string>) => {
    for (const k of Object.keys(style)) touched.current.add(k)
    setDirty(true)
    setVals((v) => {
      const next = { ...v }
      for (const [k, val] of Object.entries(style)) {
        const tok = /^theme:[A-Za-z]+:(#[0-9a-fA-F]{3,8})$/.exec(val)
        next[k] = tok ? tok[1].toLowerCase() : val
      }
      return next
    })
    apply({ style })
  }
  const setPx = (key: string, n: number) => set({ [key]: `${n}px` })
  const n = (key: string) => px(vals[key])

  const setColor = (key: string, c: { hex: string; token?: ThemeColorKey }) => {
    setTokens((t) => ({ ...t, [key]: c.token }))
    set({ [key]: c.token ? `theme:${c.token}:${c.hex}` : c.hex })
  }
  const colorRow = (label: string, key: string, allowNone?: boolean) => (
    <ColorRow label={label} hex={vals[key]} token={tokens[key]} allowNone={allowNone} onPick={(c) => setColor(key, c)} />
  )

  const applyShadow = (s: Shadow) => {
    setShadow(s)
    set(
      s.opacity > 0
        ? { shadowColor: "#000", shadowOffset: `0,${s.y}`, shadowOpacity: String(s.opacity), shadowRadius: String(s.blur), elevation: String(Math.max(1, Math.round(s.blur / 2))) }
        : { shadowOffset: "0,0", shadowOpacity: "0", shadowRadius: "0", elevation: "0" }
    )
  }

  const setSize = (key: "width" | "height", mode: SizeMode) => {
    setSizeMode((m) => ({ ...m, [key]: mode }))
    set({ [key]: mode === "auto" ? "auto" : mode === "fill" ? "100%" : `${Math.max(1, Math.round(element.rect[key]))}px` })
  }

  const changeText = (v: string) => {
    setText(v)
    textTouched.current = true
    setDirty(true)
    apply({ text: v })
  }

  const reset = () => {
    const style: Record<string, string> = {}
    for (const k of touched.current) {
      if (SHADOW_KEYS.includes(k)) continue
      const v = orig.current[k]
      // A property the source never set is put back to what it was showing.
      style[k] = v === "" ? "0px" : v
    }
    const hadShadow = SHADOW_KEYS.some((k) => touched.current.has(k))
    setVals(orig.current)
    setTokens({})
    setSizeMode({ width: "auto", height: "auto" })
    touched.current.clear()
    setDirty(false)
    if (Object.keys(style).length) apply({ style })
    if (hadShadow) {
      const s = origShadow.current
      setShadow(s)
      apply({
        style: s.opacity > 0
          ? { shadowColor: "#000", shadowOffset: `0,${s.y}`, shadowOpacity: String(s.opacity), shadowRadius: String(s.blur), elevation: String(Math.max(1, Math.round(s.blur / 2))) }
          : { shadowOffset: "0,0", shadowOpacity: "0", shadowRadius: "0", elevation: "0" },
      })
    }
    if (textTouched.current) {
      setText(origText.current)
      apply({ text: origText.current })
      textTouched.current = false
    }
    if (imageTouched.current) {
      applyImageSrc(origImage.current)
      imageTouched.current = false
    }
  }

  const sendAI = () => {
    const t = aiText.trim()
    if (!t || disabledAI) return
    onAskAI(t)
    setAiText("")
  }

  // ---- ImageKit handlers
  const handleApplyTransform = async (customPrompt?: string) => {
    const promptToUse = customPrompt || transformPrompt
    if (!promptToUse.trim()) return
    setImageLoading(true)
    setImageError(null)
    setImageSuccess(null)
    try {
      const fallbackBase = "https://ik.imagekit.io/demo/img/default-image.jpg"
      const res = await apiClient.post<{ ok: boolean; transformedUrl: string; error?: string }>(
        "/api/imagekit/transform",
        {
          imageUrl: currentImage || fallbackBase,
          prompt: promptToUse,
        }
      )
      if (res.data.transformedUrl) {
        applyImageSrc(res.data.transformedUrl)
      } else {
        setImageError(res.data.error || "Failed to transform image")
      }
    } catch (e: unknown) {
      console.error("ImageKit transform failed", e)
      const err = e as { response?: { data?: { error?: string } } }
      setImageError(err?.response?.data?.error || "Failed to apply transformation. Please try again.")
    } finally {
      setImageLoading(false)
    }
  }

  const handleGenerateImage = async () => {
    if (!generatePrompt.trim()) return
    setImageLoading(true)
    setImageError(null)
    setImageSuccess(null)
    try {
      const res = await apiClient.post<{ ok: boolean; imageUrl: string; error?: string }>(
        "/api/imagekit/generate",
        {
          prompt: generatePrompt,
          style: generateStyle,
        }
      )
      if (res.data.imageUrl) {
        applyImageSrc(res.data.imageUrl)
      } else {
        setImageError(res.data.error || "Failed to generate image")
      }
    } catch (e: unknown) {
      console.error("ImageKit generation failed", e)
      const err = e as { response?: { data?: { error?: string } } }
      setImageError(err?.response?.data?.error || "Failed to generate AI image. Please try again.")
    } finally {
      setImageLoading(false)
    }
  }

  const handleReplaceWithUrl = (urlToUse?: string) => {
    const targetUrl = (urlToUse || replaceUrl).trim()
    if (!targetUrl) return
    applyImageSrc(targetUrl)
    setReplaceUrl("")
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageLoading(true)
    setImageError(null)
    setImageSuccess(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await apiClient.post<{ ok: boolean; url: string; error?: string }>(
        "/api/imagekit/upload",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      )
      if (res.data.url) {
        applyImageSrc(res.data.url)
      } else {
        setImageError(res.data.error || "Failed to upload image")
      }
    } catch (e: unknown) {
      console.error("ImageKit upload failed", e)
      const err = e as { response?: { data?: { error?: string } } }
      setImageError(err?.response?.data?.error || "Failed to upload image. Please try again.")
    } finally {
      setImageLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // ---- sections
  const imageSection = (
    <div className="space-y-3">
      {/* Action Mode Switcher */}
      <Segmented
        label="Image action"
        className="w-full"
        value={imageMode}
        options={[
          { value: "transform", label: "AI Transform", icon: Sparkles },
          { value: "generate", label: "Generate AI", icon: Wand2 },
          { value: "replace", label: "Replace", icon: RefreshCw },
        ]}
        onChange={(v) => {
          setImageMode(v as "transform" | "generate" | "replace")
          setImageError(null)
          setImageSuccess(null)
        }}
      />

      {/* Current Image Card */}
      <div className="flex items-center gap-2.5 rounded-(--r-md) border border-border bg-muted/40 p-2">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-[calc(var(--r-md)-2px)] border border-border bg-background">
          {currentImage ? (
            <img
              src={currentImage}
              alt="Current element"
              className="size-full object-cover"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).src = "https://ik.imagekit.io/demo/img/default-image.jpg"
              }}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold">
              {currentImage?.includes("imagekit.io") ? "ImageKit Active" : "Selected Image"}
            </span>
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
              ImageKit AI
            </span>
          </div>
          <p className="truncate text-[10px] text-muted-foreground" title={currentImage}>
            {currentImage ? currentImage.replace(/^https?:\/\//, "") : "No image URL"}
          </p>
        </div>
        {currentImage !== origImage.current && origImage.current && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Revert to original image"
            onClick={() => {
              applyImageSrc(origImage.current)
              imageTouched.current = false
            }}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Option 1: AI Transformation */}
      {imageMode === "transform" && (
        <div className="space-y-2.5 animate-in fade-in-50 duration-150">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Sparkles className="size-3.5 text-primary" /> Transform with ImageKit AI
            </label>
            <p className="text-[11px] text-muted-foreground">
              Describe how to transform this image (background, shadow, fill, upscale).
            </p>
          </div>

          <div className="rounded-(--r-md) border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <textarea
              rows={2}
              value={transformPrompt}
              placeholder="e.g. 'remove background and add shadow' or 'change background to sunset city'..."
              aria-label="ImageKit AI transformation prompt"
              onChange={(e) => setTransformPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (transformPrompt.trim() && !imageLoading) void handleApplyTransform()
                }
              }}
              className="block w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">Quick transformations:</span>
            <div className="flex flex-wrap gap-1">
              {TRANSFORM_PRESETS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    setTransformPrompt(q.prompt)
                    void handleApplyTransform(q.prompt)
                  }}
                  disabled={imageLoading}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground active:scale-95 disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            disabled={imageLoading || !transformPrompt.trim()}
            onClick={() => void handleApplyTransform()}
            className="w-full h-8 text-xs font-medium bg-linear-to-r from-primary to-violet-600 text-primary-foreground shadow-sm hover:brightness-110"
          >
            {imageLoading ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Transforming with ImageKit AI...
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 size-3.5" />
                Apply AI Transformation
              </>
            )}
          </Button>
        </div>
      )}

      {/* Option 2: Generate AI Image */}
      {imageMode === "generate" && (
        <div className="space-y-2.5 animate-in fade-in-50 duration-150">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Wand2 className="size-3.5 text-primary" /> Generate AI Image
            </label>
            <p className="text-[11px] text-muted-foreground">
              Generate a new image and manage/transform it via ImageKit.
            </p>
          </div>

          <div className="rounded-(--r-md) border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <textarea
              rows={2}
              value={generatePrompt}
              placeholder="e.g. 'Fresh avocado toast with poached egg on marble counter'..."
              aria-label="Generate AI image prompt"
              onChange={(e) => setGeneratePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (generatePrompt.trim() && !imageLoading) void handleGenerateImage()
                }
              }}
              className="block w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">Visual Style:</span>
            <div className="flex flex-wrap gap-1">
              {GENERATE_STYLES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setGenerateStyle(st.id)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    generateStyle === st.id
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            disabled={imageLoading || !generatePrompt.trim()}
            onClick={() => void handleGenerateImage()}
            className="w-full h-8 text-xs font-medium bg-linear-to-r from-violet-600 to-indigo-600 text-white shadow-sm hover:brightness-110"
          >
            {imageLoading ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Generating & Hosting with ImageKit...
              </>
            ) : (
              <>
                <Wand2 className="mr-1.5 size-3.5" />
                Generate AI Image
              </>
            )}
          </Button>
        </div>
      )}

      {/* Option 3: Replace Image */}
      {imageMode === "replace" && (
        <div className="space-y-2.5 animate-in fade-in-50 duration-150">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <RefreshCw className="size-3.5 text-primary" /> Replace Image
            </label>
            <p className="text-[11px] text-muted-foreground">
              Upload from your computer to ImageKit or provide an image URL.
            </p>
          </div>

          {/* Upload file to ImageKit */}
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFileUpload(e)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={imageLoading}
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-8 text-xs font-medium border-dashed hover:border-primary/60"
          >
            {imageLoading ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Uploading to ImageKit...
              </>
            ) : (
              <>
                <Upload className="mr-1.5 size-3.5" />
                Upload Image File
              </>
            )}
          </Button>

          {/* Enter URL */}
          <div className="flex gap-1.5">
            <Input
              value={replaceUrl}
              onChange={(e) => setReplaceUrl(e.target.value)}
              placeholder="Paste image URL (https://...)"
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && replaceUrl.trim()) {
                  e.preventDefault()
                  handleReplaceWithUrl()
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!replaceUrl.trim()}
              onClick={() => handleReplaceWithUrl()}
              className="h-8 shrink-0 text-xs px-2.5"
            >
              Apply
            </Button>
          </div>

          {/* Curated Presets */}
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">Curated Presets:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_REPLACE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleReplaceWithUrl(p.url)}
                  className="flex items-center gap-1.5 rounded-(--r-md) border border-border p-1 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                >
                  <img src={p.url} alt={p.name} className="size-6 rounded object-cover shrink-0" />
                  <span className="truncate text-[10px] font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Feedback States */}
      {imageSuccess && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium animate-in fade-in-50">
          <Check className="size-3 shrink-0" /> {imageSuccess}
        </p>
      )}
      {imageError && (
        <p className="text-[11px] text-destructive leading-tight">{imageError}</p>
      )}
    </div>
  )

  const textSection = (
    <div className="space-y-1">
      <Row label="Content">
        <Input value={text} placeholder="Text" aria-label="Text content" onChange={(e) => changeText(e.target.value)} className="h-9 w-[190px] text-sm" />
      </Row>
      {canEditStyle && (
        <>
          <Row label="Size">
            <NumberBox label="Font size" value={n("fontSize")} min={8} max={96} suffix="px" onChange={(v) => setPx("fontSize", v)} />
          </Row>
          <Row label="Weight">
            <Segmented
              label="Font weight"
              className="w-[190px]"
              value={Number(vals.fontWeight) >= 700 ? "700" : Number(vals.fontWeight) >= 600 ? "600" : Number(vals.fontWeight) >= 500 ? "500" : "400"}
              options={[{ value: "400", label: "Reg" }, { value: "500", label: "Med" }, { value: "600", label: "Semi" }, { value: "700", label: "Bold" }]}
              onChange={(v) => set({ fontWeight: v })}
            />
          </Row>
          <Row label="Line height">
            <NumberBox label="Line height" value={vals.lineHeight ? n("lineHeight") : null} placeholder="Auto" max={160} suffix="px" onChange={(v) => setPx("lineHeight", v)} />
          </Row>
          <Row label="Letter spacing">
            <NumberBox label="Letter spacing" value={n("letterSpacing")} min={-5} max={20} step={0.5} suffix="px" onChange={(v) => setPx("letterSpacing", v)} />
          </Row>
          <Row label="Align">
            <Segmented
              label="Text alignment"
              className="w-[190px]"
              value={vals.textAlign}
              options={[{ value: "left", icon: AlignLeft, title: "Left" }, { value: "center", icon: AlignCenter, title: "Center" }, { value: "right", icon: AlignRight, title: "Right" }]}
              onChange={(v) => set({ textAlign: v })}
            />
          </Row>
          <Row label="Style">
            <div className="flex items-center gap-0.5">
              <Toggle pressed={Number(vals.fontWeight) >= 600} label="Bold" icon={Bold} onClick={() => set({ fontWeight: Number(vals.fontWeight) >= 600 ? "400" : "700" })} />
              <Toggle pressed={vals.fontStyle === "italic"} label="Italic" icon={Italic} onClick={() => set({ fontStyle: vals.fontStyle === "italic" ? "normal" : "italic" })} />
              <Toggle pressed={vals.textDecorationLine === "underline"} label="Underline" icon={Underline} onClick={() => set({ textDecorationLine: vals.textDecorationLine === "underline" ? "none" : "underline" })} />
              <Toggle pressed={vals.textDecorationLine === "line-through"} label="Strikethrough" icon={Strikethrough} onClick={() => set({ textDecorationLine: vals.textDecorationLine === "line-through" ? "none" : "line-through" })} />
            </div>
          </Row>
        </>
      )}
    </div>
  )

  const colorsSection = (
    <div>
      {canEditText && colorRow("Text", "color")}
      {colorRow("Background", "backgroundColor", true)}
    </div>
  )

  const sides = ["Top", "Right", "Bottom", "Left"] as const
  const spacingSection = (
    <div>
      <Row label="Gap">
        <NumberBox label="Gap" value={vals.gap === "" ? null : n("gap")} placeholder="Auto" max={80} suffix={vals.gap === "" ? undefined : "px"} onChange={(v) => setPx("gap", v)} />
      </Row>
      {sides.map((s) => (
        <Row key={`p${s}`} label={`Padding ${s.toLowerCase()}`}>
          <NumberBox label={`Padding ${s.toLowerCase()}`} value={n(`padding${s}`)} max={200} onChange={(v) => setPx(`padding${s}`, v)} />
        </Row>
      ))}
      {sides.map((s) => (
        <Row key={`m${s}`} label={`Margin ${s.toLowerCase()}`}>
          <NumberBox label={`Margin ${s.toLowerCase()}`} value={n(`margin${s}`)} min={-200} max={200} onChange={(v) => setPx(`margin${s}`, v)} />
        </Row>
      ))}
    </div>
  )

  const sizeRow = (label: string, key: "width" | "height") => (
    <div>
      <Row label={label}>
        <Segmented
          label={`${label} mode`}
          className="w-[190px]"
          value={sizeMode[key]}
          options={[{ value: "auto", label: "Auto" }, { value: "fill", label: "Fill" }, { value: "fixed", label: "Fixed" }]}
          onChange={(v) => setSize(key, v as SizeMode)}
        />
      </Row>
      {sizeMode[key] === "fixed" && (
        <Row label="">
          <NumberBox label={label} value={n(key)} min={1} max={2000} suffix="px" onChange={(v) => setPx(key, v)} />
        </Row>
      )}
    </div>
  )

  const layoutSection = (
    <div>
      {sizeRow("Width", "width")}
      {sizeRow("Height", "height")}
      <Row label="Fill space">
        <Segmented label="Grow to fill the free space" className="w-[190px]" value={vals.flexGrow === "1" ? "on" : "off"} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} onChange={(v) => set({ flexGrow: v === "on" ? "1" : "0" })} />
      </Row>
      {isFlex ? (
        <>
          <Row label="Direction">
            <Segmented label="Direction" className="w-[190px]" value={vals.flexDirection} options={[{ value: "row", label: "Row" }, { value: "column", label: "Column" }]} onChange={(v) => set({ flexDirection: v })} />
          </Row>
          <Row label="Justify">
            <Segmented
              label="Justify content"
              className="w-[220px]"
              value={vals.justifyContent}
              options={[{ value: "flex-start", label: "Start" }, { value: "center", label: "Center" }, { value: "flex-end", label: "End" }, { value: "space-between", label: "Between" }]}
              onChange={(v) => set({ justifyContent: v })}
            />
          </Row>
          <Row label="Align">
            <Segmented
              label="Align items"
              className="w-[220px]"
              value={vals.alignItems}
              options={[{ value: "flex-start", label: "Start" }, { value: "center", label: "Center" }, { value: "flex-end", label: "End" }, { value: "stretch", label: "Stretch" }]}
              onChange={(v) => set({ alignItems: v })}
            />
          </Row>
          <Row label="Wrap">
            <Segmented label="Wrap" className="w-[190px]" value={vals.flexWrap} options={[{ value: "nowrap", label: "No wrap" }, { value: "wrap", label: "Wrap" }]} onChange={(v) => set({ flexWrap: v })} />
          </Row>
        </>
      ) : (
        <p className="py-1 text-xs text-muted-foreground">Direction and alignment apply to containers like rows and stacks.</p>
      )}
    </div>
  )

  const borderSection = (
    <div>
      <Row label="Width">
        <NumberBox
          label="Border width"
          value={n("borderWidth")}
          max={16}
          suffix="px"
          onChange={(v) => {
            // A border with no color set would come out black: start from the theme's border color.
            const borderHex = themeHex(theme?.colors.border)
            if (v > 0 && n("borderWidth") === 0 && !touched.current.has("borderColor")) {
              setTokens((t) => ({ ...t, borderColor: borderHex ? "border" : undefined }))
              set({ borderWidth: `${v}px`, borderColor: borderHex ? `theme:border:${borderHex}` : vals.borderColor })
            } else setPx("borderWidth", v)
          }}
        />
      </Row>
      <Row label="Style">
        <Segmented label="Border style" className="w-[190px]" value={vals.borderStyle} options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} onChange={(v) => set({ borderStyle: v })} />
      </Row>
      {colorRow("Color", "borderColor")}
      <Row label="Radius">
        <NumberBox
          label="Corner radius"
          value={cornersEach ? null : n("borderRadius")}
          placeholder="Mixed"
          max={200}
          suffix={cornersEach ? undefined : "px"}
          onChange={(v) => {
            setCornersEach(false)
            set({ borderRadius: `${v}px`, borderTopLeftRadius: `${v}px`, borderTopRightRadius: `${v}px`, borderBottomRightRadius: `${v}px`, borderBottomLeftRadius: `${v}px` })
          }}
        />
      </Row>
      <button type="button" onClick={() => setCornersEach((c) => !c)} className="mb-1 ml-auto block text-xs text-primary hover:underline">
        {cornersEach ? "Use one radius" : "Set each corner"}
      </button>
      {cornersEach &&
        (["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const).map((c) => (
          <Row key={c} label={`${c.replace(/([A-Z])/g, " $1").trim()}`}>
            <NumberBox label={`${c} radius`} value={n(`border${c}Radius`)} max={200} suffix="px" onChange={(v) => setPx(`border${c}Radius`, v)} />
          </Row>
        ))}
    </div>
  )

  const effectsSection = (
    <div>
      <Row label="Opacity">
        <div className="flex w-[190px] items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(Number(vals.opacity) * 100)}
            aria-label="Opacity"
            onChange={(e) => set({ opacity: String(Number(e.target.value) / 100) })}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
          />
          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{Math.round(Number(vals.opacity) * 100)}%</span>
        </div>
      </Row>
      <Row label="Shadow">
        <Segmented
          label="Shadow"
          className="w-[220px]"
          value={presetOf(shadow)}
          options={[{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]}
          onChange={(v) => applyShadow(v === "none" ? NO_SHADOW : SHADOWS[v])}
        />
      </Row>
      {shadow.opacity > 0 && (
        <>
          <Row label="Offset Y">
            <NumberBox label="Shadow offset" value={shadow.y} min={-40} max={40} suffix="px" onChange={(v) => applyShadow({ ...shadow, y: v })} />
          </Row>
          <Row label="Blur">
            <NumberBox label="Shadow blur" value={shadow.blur} max={60} suffix="px" onChange={(v) => applyShadow({ ...shadow, blur: v })} />
          </Row>
          <Row label="Strength">
            <NumberBox label="Shadow strength" value={Math.round(shadow.opacity * 100)} min={1} max={100} suffix="%" onChange={(v) => applyShadow({ ...shadow, opacity: v / 100 })} />
          </Row>
        </>
      )}
      <Row label="Overflow">
        <Segmented label="Overflow" className="w-[190px]" value={vals.overflow} options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Clip" }]} onChange={(v) => set({ overflow: v })} />
      </Row>
    </div>
  )

  const sectionBody: Record<TabId, React.ReactNode> = { image: imageSection, text: textSection, colors: colorsSection, spacing: spacingSection, layout: layoutSection, border: borderSection, effects: effectsSection }
  const activeTab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? (isImage ? "image" : "colors"))

  const KindIcon = KIND_ICON[kind]
  const title = elementName(element.tag)

  return (
    <div
      role="dialog"
      aria-label={`Edit ${title}`}
      className={cn(
        "flex max-h-[550px] flex-col overflow-hidden rounded-(--r-lg) border border-border bg-background text-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150",
        isImage ? "w-[350px]" : "w-[340px]"
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2.5 px-3 pt-3 pb-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-(--r-md) bg-primary/10 text-primary">
          <KindIcon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold" title={element.text ?? title}>{title}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" aria-live="polite">
            <span className="truncate">{screenName ?? "Screen"}</span>
            {saveState === "saving" && <Loader2 className="size-3 shrink-0 animate-spin" aria-label="Saving" />}
            {saveState === "saved" && <Check className="size-3 shrink-0 text-emerald-600" aria-label="Saved" />}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Select parent" title={element.parent ? `Select parent (${elementName(element.parent)})` : "No parent to select"} disabled={!element.parent} onClick={onSelectParent}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Reset changes" title="Reset changes to this element" disabled={!dirty} onClick={reset}>
          <RotateCcw />
        </Button>
        <Button
          variant={advanced ? "secondary" : "ghost"}
          size="icon-sm"
          aria-pressed={advanced}
          aria-label={advanced ? "Switch to quick edit" : "Switch to advanced edit"}
          title={advanced ? "Quick edit" : "Advanced edit: every property"}
          onClick={() => onAdvancedChange(!advanced)}
        >
          <SlidersHorizontal />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close editor" title="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      {/* Tabs (quick edit) */}
      {!advanced && !aiOpen && tabs.length > 1 && (
        <div role="tablist" aria-label="Properties" className="flex shrink-0 gap-1 border-b border-border px-2 pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-(--r-md) py-1.5 text-[11px] font-medium transition-colors",
                activeTab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <t.icon className="size-[18px]" />
              {t.label}
            </button>
          ))}
        </div>
      )}
      {(advanced || aiOpen || tabs.length <= 1) && <div className="shrink-0 border-b border-border" />}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {aiOpen ? (
          <AskAI value={aiText} onChange={setAiText} onSend={() => { sendAI(); setAiOpen(false) }} disabled={disabledAI} />
        ) : !canEditStyle ? (
          <div className="space-y-3">
            {canEditText && textSection}
            <p className="text-xs text-muted-foreground">This is a kit component; its look follows the app&apos;s theme. Use Edit with AI to restyle it.</p>
          </div>
        ) : advanced ? (
          <>
            {tabs.map((t) => (
              <Section key={t.id} icon={t.icon} title={t.id === "text" ? "Text" : t.label}>
                {sectionBody[t.id]}
              </Section>
            ))}
          </>
        ) : (
          sectionBody[activeTab]
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border p-2.5">
        <Button variant="ghost" size="icon" aria-label="View in Code tab" title="View in Code tab" onClick={onViewCode} className="size-10 shrink-0">
          <Code2 />
        </Button>
        <button
          type="button"
          aria-pressed={aiOpen}
          onClick={() => setAiOpen((o) => !o)}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-(--r-md) bg-linear-to-r from-primary to-violet-500 text-sm font-medium text-primary-foreground shadow-sm transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-3 focus-visible:ring-primary/30 focus-visible:outline-none"
        >
          <Sparkles className="size-4" />
          {aiOpen ? "Back to properties" : "Edit with AI"}
        </button>
      </div>
    </div>
  )
}

/** The "Edit with AI" box: sends an instruction about this element to the chat's AI agent. */
function AskAI({ value, onChange, onSend, disabled }: { value: string; onChange: (v: string) => void; onSend: () => void; disabled?: boolean }) {
  const canSend = !!value.trim() && !disabled
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" /> Edit with AI
      </p>
      <div className="flex items-end gap-1.5 rounded-(--r-md) border border-input bg-background p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          autoFocus
          value={value}
          rows={3}
          placeholder="Describe the change to this element…"
          aria-label="Edit this element with AI"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) onSend()
            }
          }}
          className="block max-h-28 min-h-14 flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="button" size="icon-sm" disabled={!canSend} onClick={onSend} aria-label="Send to AI" className="shrink-0">
          <ArrowUp />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => onChange(s)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground">
            {s}
          </button>
        ))}
      </div>
      {disabled && <p className="text-xs text-muted-foreground">The agent is busy. Try again in a moment.</p>}
    </div>
  )
}
