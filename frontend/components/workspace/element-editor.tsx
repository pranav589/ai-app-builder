"use client"

import * as React from "react"
import {
  ArrowUp,
  Code2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import type { ThemeColorKey } from "@app/shared/app-runtime/theme"
import { elementKind, elementName } from "@app/shared/preview/element-names"
import type { ElementEdit } from "@app/shared/preview/protocol"
import { useAppTheme } from "./app-runtime"

import {
  AskAI,
  BorderSection,
  ColorRow,
  ColorsSection,
  EffectsSection,
  ImageSection,
  initialValues,
  KIND_ICON,
  LayoutSection,
  NO_SHADOW,
  parseShadow,
  px,
  Section,
  SHADOW_KEYS,
  SHADOWS,
  SpacingSection,
  TABS,
  TextSection,
  themeHex,
  type ElementEditorProps,
  type PendingEdit,
  type Shadow,
  type SizeMode,
  type TabId,
  type Vals,
} from "./element-editor/index"

/**
 * The inline editor's popover: Colors, Spacing, Layout, Border and Effects
 * (plus Text for text), one tab at a time, or every section in one list in
 * Advanced. Every change shows in the screen immediately (`onChange`); the
 * workspace saves them when Edit Mode is closed with Done.
 */
export function ElementEditor({
  element,
  screenName,
  advanced,
  onAdvancedChange,
  onClose,
  onSelectParent,
  onChange,
  onViewCode,
  onAskAI,
  disabledAI,
}: ElementEditorProps) {
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
  const [dirty, setDirty] = React.useState(false)

  // ImageKit states
  const [currentImage, setCurrentImage] = React.useState<string>(element.imageSrc ?? "")
  const imageTouched = React.useRef(false)

  const touched = React.useRef(new Set<string>())
  const textTouched = React.useRef(false)

  // `from` is the text as the element showed it when picked, so the save
  // (on Done) edits exactly that text in the source and refuses rather than guess.
  const apply = (edit: PendingEdit) =>
    onChange({ eid, ...edit, from: edit.text !== undefined ? (element.text ?? undefined) : undefined })

  const applyImageSrc = (newUrl: string) => {
    setCurrentImage(newUrl)
    imageTouched.current = true
    setDirty(true)
    apply({ imageSrc: newUrl })
  }

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

  const onBorderWidthChange = (v: number) => {
    // A border with no color set would come out black: start from the theme's border color.
    const borderHex = themeHex(theme?.colors.border)
    if (v > 0 && n("borderWidth") === 0 && !touched.current.has("borderColor")) {
      setTokens((t) => ({ ...t, borderColor: borderHex ? "border" : undefined }))
      set({ borderWidth: `${v}px`, borderColor: borderHex ? `theme:border:${borderHex}` : vals.borderColor })
    } else setPx("borderWidth", v)
  }

  const sectionBody: Record<TabId, React.ReactNode> = {
    image: (
      <ImageSection
        currentImage={currentImage}
        origImage={origImage.current}
        onApplyImageSrc={applyImageSrc}
        onRevertImage={() => {
          applyImageSrc(origImage.current)
          imageTouched.current = false
        }}
      />
    ),
    text: (
      <TextSection
        text={text}
        onChangeText={changeText}
        canEditStyle={canEditStyle}
        vals={vals}
        onSet={set}
        onSetPx={setPx}
        n={n}
      />
    ),
    colors: (
      <ColorsSection
        canEditText={canEditText}
        colorRow={colorRow}
      />
    ),
    spacing: (
      <SpacingSection
        vals={vals}
        n={n}
        onSetPx={setPx}
      />
    ),
    layout: (
      <LayoutSection
        sizeMode={sizeMode}
        onSetSize={setSize}
        vals={vals}
        n={n}
        onSetPx={setPx}
        onSet={set}
        isFlex={isFlex}
      />
    ),
    border: (
      <BorderSection
        vals={vals}
        n={n}
        onSet={set}
        onSetPx={setPx}
        colorRow={colorRow}
        cornersEach={cornersEach}
        setCornersEach={setCornersEach}
        onBorderWidthChange={onBorderWidthChange}
      />
    ),
    effects: (
      <EffectsSection
        vals={vals}
        shadow={shadow}
        onSet={set}
        onApplyShadow={applyShadow}
      />
    ),
  }

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
            {canEditText && sectionBody.text}
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
