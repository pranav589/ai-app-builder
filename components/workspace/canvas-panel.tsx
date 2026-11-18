"use client"

import * as React from "react"
import { AlertTriangle, Check, Clock, Hand, Loader2, Maximize, Minus, MousePointer2, Pencil, Plus, Smartphone, Sparkles } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import type { ElementEdit, SelectedElement } from "@/lib/preview/protocol"
import { DEVICE_HEIGHT, DEVICE_WIDTH, SCREEN_HEIGHT, SCREEN_WIDTH } from "./dummy-data"
import { ElementEditor } from "./element-editor"
import { PhoneFrame, ScreenView } from "./screen-mock"
import type { FrameHandlers } from "./app-runtime"
import { ThemeSwitcher } from "./theme-switcher"
import type { ThemePackage } from "@/lib/app-runtime/theme"
import type { ScreenNode } from "./types"

type Camera = { x: number; y: number; zoom: number }
type Tool = "select" | "hand"
type Drag =
  | { mode: "pan"; pointerId: number; startX: number; startY: number; cam: Camera; moved: boolean }
  | { mode: "move"; pointerId: number; startX: number; startY: number; id: string; origin: { x: number; y: number } }

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2
const LABEL_HEIGHT = 32
// The device is drawn inside the bezel (PhoneFrame's 7px padding), scaled to fit.
const BEZEL = 7
const DEVICE_SCALE = Math.min((SCREEN_WIDTH - BEZEL * 2) / DEVICE_WIDTH, (SCREEN_HEIGHT - BEZEL * 2) / DEVICE_HEIGHT)

/** Inline editing (Edit Mode), owned by the workspace so the chat can see the selected element. */
export type InlineEditing = {
  /** The screen in Edit Mode, if any. */
  screenId: string | null
  element: SelectedElement | null
  edit: ElementEdit | null
  deselectKey: number
  selectParentKey: number
  advanced: boolean
  onAdvancedChange: (advanced: boolean) => void
  onToggle: (screen: ScreenNode) => void
  onSelectElement: (screenId: string, el: SelectedElement) => void
  onDeselect: () => void
  onSelectParent: () => void
  onRect: (eid: string, rect: SelectedElement["rect"]) => void
  onPreview: (edit: ElementEdit) => void
  onSave: (edit: ElementEdit, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string; resynced?: boolean; aborted?: boolean }>
  onViewCode: () => void
  onAskAI: (instruction: string) => void
  aiDisabled: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))

function ScreenLabel({ screen, zoom, editing, canEdit, onToggleEdit }: { screen: ScreenNode; zoom: number; editing: boolean; canEdit: boolean; onToggleEdit: () => void }) {
  return (
    // Rendered at a constant on-screen size, whatever the zoom.
    <div
      className="absolute bottom-full left-0 flex origin-bottom-left items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground"
      style={{ height: LABEL_HEIGHT, width: SCREEN_WIDTH * zoom, transform: `scale(${1 / zoom})` }}
    >
      {screen.state === "generating" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : screen.state === "error" ? (
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
      ) : screen.state === "pending" ? (
        <Clock className="size-3.5 shrink-0 opacity-60" />
      ) : (
        <Smartphone className="size-3.5 shrink-0" />
      )}
      <span
        className={cn("truncate", screen.state === "generating" && "text-foreground", screen.state === "pending" && "opacity-60")}
        title={`${screen.name}${screen.state === "generating" ? " (designing)" : screen.state === "pending" ? " (queued)" : ""}`}
      >
        {screen.name}
      </span>
      {screen.state === "ready" && (
        <button
          type="button"
          data-canvas-ui
          disabled={!canEdit}
          aria-pressed={editing}
          aria-label={editing ? `Finish editing ${screen.name}` : `Edit ${screen.name}`}
          title={editing ? "Done editing" : "Edit this screen: click any element to change it"}
          onClick={onToggleEdit}
          className={cn(
            "ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40",
            editing ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"
          )}
        >
          {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
          {editing && "Done"}
        </button>
      )}
    </div>
  )
}

function SelectionToolbar({ zoom, disabled, onEdit }: { zoom: number; disabled: boolean; onEdit: () => void }) {
  return (
    <div
      data-canvas-ui
      className="absolute left-1/2 flex origin-bottom items-center gap-0.5 rounded-(--r-md) border border-border bg-background p-1 shadow-lg"
      // Stay readable at any zoom level.
      style={{ bottom: `calc(100% + ${(LABEL_HEIGHT + 4) / zoom}px)`, transform: `translateX(-50%) scale(${1 / zoom})` }}
    >
      <Button size="sm" className="h-7 rounded-(--r-sm)" onClick={onEdit} disabled={disabled}>
        <Sparkles /> Edit with AI
      </Button>
    </div>
  )
}

/** The editor, placed next to the selected element on its screen, at a constant on-screen size whatever the zoom. */
function EditorPopover({ zoom, element, screenName, inline }: { zoom: number; element: SelectedElement; screenName: string; inline: InlineEditing }) {
  const { rect } = element
  const top = BEZEL + rect.y * DEVICE_SCALE
  const bottom = top + rect.height * DEVICE_SCALE
  // Opens below the element, or above it when the element sits in the lower half.
  const above = (top + bottom) / 2 > SCREEN_HEIGHT / 2
  const gap = 10 / zoom
  return (
    <div
      data-canvas-ui
      className="absolute z-10"
      style={{
        left: SCREEN_WIDTH / 2,
        ...(above ? { bottom: SCREEN_HEIGHT - Math.max(top, 0) + gap } : { top: Math.min(bottom, SCREEN_HEIGHT) + gap }),
        transform: `translateX(-50%) scale(${1 / zoom})`,
        transformOrigin: above ? "bottom center" : "top center",
      }}
    >
      <ElementEditor
        key={`${element.eid}|${element.text ?? ""}`}
        element={element}
        screenName={screenName}
        onSelectParent={inline.onSelectParent}
        advanced={inline.advanced}
        onAdvancedChange={inline.onAdvancedChange}
        onClose={inline.onDeselect}
        onPreview={inline.onPreview}
        onSave={inline.onSave}
        onViewCode={inline.onViewCode}
        onAskAI={inline.onAskAI}
        disabledAI={inline.aiDisabled}
      />
    </div>
  )
}

export function CanvasPanel({
  screens,
  onScreensChange,
  selectedId,
  onSelect,
  onEdit,
  busy,
  themes,
  onThemeChange,
  buildingThemes,
  appName,
  notice,
  inline,
}: {
  inline: InlineEditing
  appName: string
  /** A short status shown under the theme menu, e.g. a crash being repaired. */
  notice?: string | null
  themes: ThemePackage | null
  onThemeChange: (id: string) => void
  buildingThemes: boolean
  screens: ScreenNode[]
  onScreensChange: (updater: (prev: ScreenNode[]) => ScreenNode[]) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEdit: (screen: ScreenNode) => void
  busy: boolean
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const [cam, setCam] = React.useState<Camera>({ x: 0, y: 0, zoom: 0.6 })
  const camRef = React.useRef(cam)
  camRef.current = cam
  const [tool, setTool] = React.useState<Tool>("select")
  const [spaceHeld, setSpaceHeld] = React.useState(false)
  const [drag, setDrag] = React.useState<Drag | null>(null)
  const dragRef = React.useRef<Drag | null>(null)
  const fitted = React.useRef(false)

  const inlineRef = React.useRef(inline)
  inlineRef.current = inline

  const panning = tool === "hand" || spaceHeld

  // What the screen in Edit Mode reports back, each routed to that screen.
  const editingId = inline.screenId
  const { onSelectElement, onDeselect, onRect } = inline
  const frameHandlers = React.useMemo<FrameHandlers>(
    () => ({
      onSelectElement: (el) => editingId && onSelectElement(editingId, el),
      onDeselectElement: onDeselect,
      onElementRect: onRect,
    }),
    [editingId, onSelectElement, onDeselect, onRect]
  )

  const fit = React.useCallback(() => {
    const el = viewportRef.current
    if (!el || screens.length === 0) return
    const { width, height } = el.getBoundingClientRect()
    if (!width || !height) return
    const minX = Math.min(...screens.map((s) => s.x))
    const minY = Math.min(...screens.map((s) => s.y)) - LABEL_HEIGHT * 2
    const maxX = Math.max(...screens.map((s) => s.x + SCREEN_WIDTH))
    const maxY = Math.max(...screens.map((s) => s.y + SCREEN_HEIGHT))
    const pad = 64
    const zoom = clamp(Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY), 1), MIN_ZOOM, MAX_ZOOM)
    setCam({
      zoom,
      x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (height - (maxY - minY) * zoom) / 2 - minY * zoom,
    })
  }, [screens])

  // Fit the screens once the canvas has a size, and again whenever screens are added or removed.
  const fitRef = React.useRef(fit)
  fitRef.current = fit
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!fitted.current && el.clientWidth > 0) {
        fitted.current = true
        fitRef.current()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  React.useEffect(() => {
    if (fitted.current) fitRef.current()
  }, [screens.length])

  const zoomAt = React.useCallback((factor: number, px?: number, py?: number) => {
    const el = viewportRef.current
    if (!el) return
    const c = camRef.current
    const cx = px ?? el.clientWidth / 2
    const cy = py ?? el.clientHeight / 2
    const zoom = clamp(c.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const wx = (cx - c.x) / c.zoom
    const wy = (cy - c.y) / c.zoom
    setCam({ zoom, x: cx - wx * zoom, y: cy - wy * zoom })
  }, [])

  // Wheel: pinch / ctrl+wheel zooms around the cursor, plain wheel pans.
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-canvas-ui]")) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setCam((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  // Keyboard shortcuts (ignored while typing anywhere).
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const inCanvas = !!viewportRef.current?.contains(document.activeElement)
      if (e.code === "Space" && inCanvas) {
        e.preventDefault()
        setSpaceHeld(true)
      }
      if (!inCanvas || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "v" || e.key === "V") setTool("select")
      if (e.key === "h" || e.key === "H") setTool("hand")
      if (e.key === "Escape") {
        if (inlineRef.current.screenId) inlineRef.current.onDeselect()
        else onSelect(null)
      }
      if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) fit()
    }
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [fit, onSelect])

  const setDragState = (d: Drag | null) => {
    dragRef.current = d
    setDrag(d)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest("[data-canvas-ui]")) return
    if (e.button !== 0 && e.button !== 1) return
    const screenEl = target.closest<HTMLElement>("[data-screen-id]")
    viewportRef.current?.focus({ preventScroll: true })

    if (screenEl && !panning && e.button === 0) {
      const id = screenEl.dataset.screenId!
      const s = screens.find((x) => x.id === id)
      if (!s) return
      onSelect(id)
      setDragState({ mode: "move", pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, id, origin: { x: s.x, y: s.y } })
      return
    }
    setDragState({ mode: "pan", pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, cam, moved: false })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    // Capture only once it's really a drag, so clicks and double-clicks
    // (e.g. renaming a screen) still reach their own targets.
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
      if (Math.hypot(dx, dy) < 3) return
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (d.mode === "pan") {
      if (!d.moved) dragRef.current = { ...d, moved: true }
      setCam({ ...d.cam, x: d.cam.x + dx, y: d.cam.y + dy })
    } else {
      const zoom = camRef.current.zoom
      onScreensChange((prev) =>
        prev.map((s) => (s.id === d.id ? { ...s, x: Math.round(d.origin.x + dx / zoom), y: Math.round(d.origin.y + dy / zoom) } : s))
      )
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    // A click on empty canvas clears the selection.
    if (d.mode === "pan" && !d.moved && !panning) onSelect(null)
    setDragState(null)
  }

  const gridSize = 24 * cam.zoom

  return (
    <div className="@container relative h-full min-h-0 overflow-hidden bg-(--surface)">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="application"
        aria-label="Screens canvas. Drag to move screens, scroll to pan, Ctrl + scroll to zoom."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "absolute inset-0 touch-none outline-none",
          panning && (drag ? "cursor-grabbing" : "cursor-grab"),
          drag?.mode === "move" && "cursor-grabbing"
        )}
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklch, var(--ink), transparent 82%) 1px, transparent 1px)",
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.zoom})` }}
        >
          {screens.map((s) => {
            const selected = s.id === selectedId
            const editing = s.id === editingId
            const el = editing ? inline.element : null
            return (
              <div
                key={s.id}
                data-screen-id={s.id}
                className="absolute"
                style={{ left: s.x, top: s.y, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, zIndex: selected ? 2 : 1 }}
              >
                {selected && !drag && !editing && (
                  <SelectionToolbar zoom={cam.zoom} disabled={busy || s.state !== "ready"} onEdit={() => onEdit(s)} />
                )}
                <ScreenLabel screen={s} zoom={cam.zoom} editing={editing} canEdit={!busy || editing} onToggleEdit={() => inline.onToggle(s)} />
                <div
                  className={cn(
                    "rounded-[48px] transition-shadow",
                    !panning && !editing && "cursor-grab active:cursor-grabbing",
                    editing && "cursor-default",
                    selected ? "ring-[3px] ring-primary ring-offset-4 ring-offset-(--surface)" : "hover:ring-2 hover:ring-primary/30 hover:ring-offset-4 hover:ring-offset-(--surface)"
                  )}
                  style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                >
                  <PhoneFrame className="size-full">
                    <ScreenView
                      id={s.id}
                      name={s.name}
                      state={s.state}
                      code={s.code}
                      error={s.error}
                      appName={appName}
                      editing={editing ? { edit: inline.edit, deselectKey: inline.deselectKey, selectParentKey: inline.selectParentKey, handlers: frameHandlers } : undefined}
                    />
                  </PhoneFrame>
                </div>
                {el && !drag && <EditorPopover zoom={cam.zoom} element={el} screenName={s.name} inline={inline} />}
              </div>
            )
          })}
        </div>
      </div>

      {screens.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-(--r-md) bg-background shadow-sm">
            <Smartphone className="size-5 text-muted-foreground" />
          </span>
          <p className="text-sm font-medium">No screens yet</p>
          <p className="max-w-64 text-sm text-muted-foreground">Screens appear here one by one once you approve the plan in chat.</p>
        </div>
      )}

      {/* Tools */}
      <div data-canvas-ui className="absolute top-3 left-3 flex items-center gap-0.5 rounded-(--r-md) border border-border bg-background p-1 shadow-sm">
        <Button
          variant={tool === "select" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-pressed={tool === "select"}
          aria-label="Select tool (V)"
          title="Select (V)"
          onClick={() => setTool("select")}
        >
          <MousePointer2 />
        </Button>
        <Button
          variant={tool === "hand" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-pressed={tool === "hand"}
          aria-label="Hand tool (H)"
          title="Pan (H or hold Space)"
          onClick={() => setTool("hand")}
        >
          <Hand />
        </Button>
      </div>

      {/* Theme package: switch the whole app's look live */}
      <div data-canvas-ui className="absolute top-3 left-1/2 z-10 -translate-x-1/2">
        <ThemeSwitcher themes={themes} onChange={onThemeChange} building={buildingThemes} />
      </div>
      {notice && (
        <div role="status" className="pointer-events-none absolute top-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          <Loader2 className="size-3.5 animate-spin text-primary" /> {notice}
        </div>
      )}

      {/* Zoom */}
      <div data-canvas-ui className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-(--r-md) border border-border bg-background p-1 shadow-sm">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>
          <Minus />
        </Button>
        <button
          type="button"
          onClick={() => zoomAt(1 / cam.zoom)}
          title="Reset to 100%"
          className="h-7 w-12 rounded-md text-xs font-medium tabular-nums transition-colors hover:bg-muted"
        >
          {Math.round(cam.zoom * 100)}%
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomAt(1.2)}>
          <Plus />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" aria-label="Fit screens (Shift+1)" title="Fit (Shift+1)" onClick={fit}>
          <Maximize />
        </Button>
      </div>

      <p className="pointer-events-none absolute bottom-5 left-4 hidden text-xs text-muted-foreground @md:block">
        {screens.length} {screens.length === 1 ? "screen" : "screens"}
      </p>
    </div>
  )
}
