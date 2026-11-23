import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { THEME_COLOR_KEYS, type ThemeColorKey } from "@app/shared/app-runtime/theme"
import { useAppTheme } from "../app-runtime"
import { HEX6 } from "./constants"
import type { Option } from "./types"
import { themeHex, tokenLabel } from "./utils"

export function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-9 items-center justify-between gap-3 py-0.5", className)}>
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  )
}

export function NumberBox({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  placeholder,
  className,
}: {
  label: string
  value: number | null
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  placeholder?: string
  className?: string
}) {
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

export function Segmented({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (v: string) => void
  className?: string
}) {
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

export function Toggle({
  pressed,
  label,
  icon: Icon,
  onClick,
}: {
  pressed: boolean
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}) {
  return (
    <Button type="button" variant={pressed ? "secondary" : "ghost"} size="icon-sm" aria-pressed={pressed} aria-label={label} title={label} onClick={onClick}>
      <Icon />
    </Button>
  )
}

export function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
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

const checker = {
  backgroundImage: "linear-gradient(45deg,#d4d4d8 25%,transparent 25%,transparent 75%,#d4d4d8 75%),linear-gradient(45deg,#d4d4d8 25%,#fff 25%,#fff 75%,#d4d4d8 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0,4px 4px",
}

/** A color property: a chip that opens the theme palette, a custom hex, or "None". */
export function ColorRow({
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
