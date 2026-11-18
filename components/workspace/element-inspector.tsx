"use client"

import * as React from "react"
import { Bold, Check, Code2, Loader2, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ElementEdit, SelectedElement } from "@/lib/preview/protocol"

/** "rgb(17, 17, 17)" / "rgba(17, 17, 17, 1)" -> "#111111". Anything else (a named color, "transparent"...) passes through unchanged. */
function toHex(css: string): string {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(css)
  if (!m) return /^#[0-9a-f]{3,8}$/i.test(css) ? css : "#000000"
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0")
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}

const px = (css: string) => Math.round(parseFloat(css)) || 0

type PendingEdit = { text?: string; style?: Record<string, string> }

/**
 * The canvas inspector's editor: text and a few style fields for the
 * currently selected element, applied live to the preview as they change and
 * saved (debounced) through the change gateway (no model call).
 */
export function ElementInspector({
  element,
  onClose,
  onPreview,
  onSave,
  onViewCode,
}: {
  element: SelectedElement
  onClose: () => void
  /** Applied immediately to the live preview, for instant feedback. */
  onPreview: (edit: ElementEdit) => void
  /** Debounced: persists the accumulated edit through the gateway. Resolves with an error message, if any. */
  onSave: (edit: ElementEdit) => Promise<{ ok: boolean; error?: string; resynced?: boolean }>
  /** Opens the Code tab at this element's source line. */
  onViewCode: () => void
}) {
  const [text, setText] = React.useState(element.text ?? "")
  const [bold, setBold] = React.useState(Number(element.styles.fontWeight) >= 600)
  const [fontSize, setFontSize] = React.useState(px(element.styles.fontSize))
  const [color, setColor] = React.useState(toHex(element.styles.color))
  const [background, setBackground] = React.useState(toHex(element.styles.backgroundColor))
  const [radius, setRadius] = React.useState(px(element.styles.borderRadius))
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = React.useState<string | null>(null)

  // A newly selected element resets every field to its own values.
  const eid = element.eid
  React.useEffect(() => {
    setText(element.text ?? "")
    setBold(Number(element.styles.fontWeight) >= 600)
    setFontSize(px(element.styles.fontSize))
    setColor(toHex(element.styles.color))
    setBackground(toHex(element.styles.backgroundColor))
    setRadius(px(element.styles.borderRadius))
    setSaveState("idle")
    setError(null)
    savedText.current = element.text ?? undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid])

  const pending = React.useRef<PendingEdit>({})
  // The text as it is in the source right now: sent with a text edit so the
  // server edits exactly that text (and refuses rather than guess).
  const savedText = React.useRef<string | undefined>(element.text ?? undefined)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = React.useRef(false)

  const flush = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (savingRef.current) {
      // A save is already in flight: try again shortly, without dropping what's pending.
      timer.current = setTimeout(flush, 200)
      return
    }
    const edit = pending.current
    const hasStyle = !!edit.style && Object.keys(edit.style).length > 0
    if (edit.text === undefined && !hasStyle) return
    pending.current = {}
    savingRef.current = true
    setSaveState("saving")
    setError(null)
    const text = edit.text
    void onSave({ eid, text, from: text !== undefined ? savedText.current : undefined, style: hasStyle ? edit.style : undefined }).then((r) => {
      savingRef.current = false
      if (r.ok) {
        if (text !== undefined) savedText.current = text
        setSaveState("saved")
      }
      else {
        setSaveState("error")
        setError(r.error ?? "Couldn't save that change.")
      }
    })
  }, [eid, onSave])

  const apply = React.useCallback(
    (edit: PendingEdit) => {
      onPreview({ eid, ...edit })
      pending.current = { text: edit.text ?? pending.current.text, style: { ...pending.current.style, ...edit.style } }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 700)
    },
    [eid, onPreview, flush]
  )

  React.useEffect(() => () => flush(), [flush])

  const canEditText = element.text !== null
  const canEditStyle = !element.kit

  return (
    <div className="mx-3 mb-3 flex shrink-0 flex-col gap-2.5 rounded-(--r-md) border border-border bg-background p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{element.tag}</span>
        <span className="flex-1" />
        {saveState === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {saveState === "saved" && <Check className="size-3.5 text-emerald-600" />}
        <Button variant="ghost" size="icon-xs" aria-label="View in Code tab" title="View in Code tab" onClick={onViewCode}>
          <Code2 />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close element editor" onClick={onClose}>
          <X />
        </Button>
      </div>

      {canEditText && (
        <Input
          value={text}
          placeholder="Text"
          onChange={(e) => {
            setText(e.target.value)
            apply({ text: e.target.value })
          }}
        />
      )}

      {!canEditStyle && (
        <p className="text-xs text-muted-foreground">
          This is a kit component; its look follows the app&apos;s theme. Ask in chat to restyle it.
        </p>
      )}

      {canEditStyle && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value)
                apply({ style: { color: e.target.value } })
              }}
              className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
              aria-label="Text color"
            />
            Text
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="color"
              value={background}
              onChange={(e) => {
                setBackground(e.target.value)
                apply({ style: { backgroundColor: e.target.value } })
              }}
              className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
              aria-label="Background color"
            />
            Fill
          </label>
          <Button
            variant={bold ? "secondary" : "ghost"}
            size="icon-xs"
            aria-pressed={bold}
            aria-label="Bold text"
            onClick={() => {
              const next = !bold
              setBold(next)
              apply({ style: { fontWeight: next ? "700" : "400" } })
            }}
          >
            <Bold />
          </Button>
        </div>
      )}

      {canEditStyle && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex flex-1 items-center gap-1.5">
            Size
            <Input
              type="number"
              min={8}
              max={96}
              value={fontSize}
              onChange={(e) => {
                const v = Number(e.target.value) || 0
                setFontSize(v)
                apply({ style: { fontSize: `${v}px` } })
              }}
              className="h-7 w-16"
            />
          </label>
          <label className="flex flex-1 items-center gap-1.5">
            Corners
            <Input
              type="number"
              min={0}
              max={64}
              value={radius}
              onChange={(e) => {
                const v = Number(e.target.value) || 0
                setRadius(v)
                apply({ style: { borderRadius: `${v}px` } })
              }}
              className="h-7 w-16"
            />
          </label>
        </div>
      )}

      {error && <p className={cn("text-xs text-destructive")}>{error}</p>}
    </div>
  )
}
