// Generated apps never hard-code colors: every screen styles itself with the
// CSS custom properties below, and a theme is just a set of values for them.
// Switching theme swaps one <style> block inside each screen, so nothing is
// regenerated. Shared by the server (agent) and the browser (workspace).

import type { AppPlan } from "@/lib/agent/types"

export const THEME_COLOR_KEYS = [
  "primary",
  "onPrimary",
  "primarySoft",
  "accent",
  "onAccent",
  "background",
  "surface",
  "surfaceAlt",
  "text",
  "textMuted",
  "border",
  "success",
  "warning",
  "danger",
] as const

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number]
export type ThemeColors = Record<ThemeColorKey, string>
export type ThemeRadius = "sharp" | "soft" | "round"

export type AppTheme = {
  /** Stable kebab-case id. */
  id: string
  name: string
  mode: "light" | "dark"
  colors: ThemeColors
  radius: ThemeRadius
}

export type ThemePackage = {
  themes: AppTheme[]
  activeId: string
  /** Hash of the design direction the package was made from. */
  hash: string
}

/** CSS variable name for each color key, e.g. onPrimary -> --color-on-primary. */
export const cssVar = (k: ThemeColorKey) => `--color-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

/** The token contract handed to the screen designer. */
export const THEME_TOKEN_DOCS: Record<ThemeColorKey, string> = {
  primary: "brand color: primary buttons, active tab, key highlights",
  onPrimary: "text/icons placed on primary",
  primarySoft: "subtle tinted background for chips, selected rows, icon tiles",
  accent: "secondary highlight: badges, streaks, small accents",
  onAccent: "text/icons placed on accent",
  background: "screen background",
  surface: "cards, sheets, tab bar, inputs",
  surfaceAlt: "secondary surface: grouped rows, segmented control track, skeletons",
  text: "primary text",
  textMuted: "secondary text, captions, placeholder, inactive icons",
  border: "hairlines and dividers",
  success: "positive state",
  warning: "attention state",
  danger: "destructive actions and errors",
}

const RADII: Record<ThemeRadius, { sm: number; md: number; lg: number; xl: number }> = {
  sharp: { sm: 4, md: 6, lg: 8, xl: 12 },
  soft: { sm: 8, md: 12, lg: 16, xl: 24 },
  round: { sm: 12, md: 18, lg: 24, xl: 32 },
}

export function themeToCss(t: AppTheme): string {
  const c = t.colors
  const r = RADII[t.radius] ?? RADII.soft
  const dark = t.mode === "dark"
  const lines = THEME_COLOR_KEYS.map((k) => `${cssVar(k)}:${c[k]};`)
  lines.push(
    `--radius-sm:${r.sm}px;--radius-md:${r.md}px;--radius-lg:${r.lg}px;--radius-xl:${r.xl}px;--radius-pill:999px;`,
    dark
      ? `--shadow-sm:0 1px 2px rgba(0,0,0,.4);--shadow-md:0 8px 24px -8px rgba(0,0,0,.6);--shadow-lg:0 20px 44px -12px rgba(0,0,0,.7);`
      : `--shadow-sm:0 1px 2px rgba(16,24,40,.06);--shadow-md:0 8px 24px -10px rgba(16,24,40,.16);--shadow-lg:0 24px 48px -16px rgba(16,24,40,.24);`,
    `--color-overlay:${dark ? "rgba(0,0,0,.6)" : "rgba(15,18,25,.38)"};`,
    `color-scheme:${t.mode};`
  )
  return `:root{${lines.join("")}}`
}

// ---------------------------------------------------------------- color math

const HEX = /^#[0-9a-f]{6}$/i

export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v.trim())

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Mixes b into a by t (0..1). */
export function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

const readableOn = (bg: string) => (contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "#ffffff" : "#111111")

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

const rotate = (hex: string, deg: number) => {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  return hslToHex((h + deg + 360) % 360, s, l)
}

// ---------------------------------------------------------------- building themes

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "theme"

type Seed = Partial<ThemeColors> & { primary: string; background: string; text: string }

/**
 * Completes a partial palette, fixing anything missing, malformed or
 * unreadable, so a theme is always usable whatever the model returned.
 */
export function completeColors(seed: Seed, mode: "light" | "dark"): ThemeColors {
  const pick = (v: string | undefined, fallback: string) => (isHex(v) ? v.trim().toLowerCase() : fallback)
  const dark = mode === "dark"
  const background = pick(seed.background, dark ? "#0f1115" : "#f6f7f9")
  const text = pick(seed.text, dark ? "#f3f4f6" : "#111318")
  const primary = pick(seed.primary, "#2f5bea")
  const accent = pick(seed.accent, rotate(primary, 40))
  const surface = pick(seed.surface, dark ? mix(background, "#ffffff", 0.06) : "#ffffff")
  const c: ThemeColors = {
    primary,
    onPrimary: pick(seed.onPrimary, readableOn(primary)),
    primarySoft: pick(seed.primarySoft, mix(surface, primary, dark ? 0.22 : 0.12)),
    accent,
    onAccent: pick(seed.onAccent, readableOn(accent)),
    background,
    surface,
    surfaceAlt: pick(seed.surfaceAlt, mix(surface, text, dark ? 0.08 : 0.05)),
    text: contrast(text, background) >= 7 ? text : readableOn(background) === "#ffffff" ? "#f5f5f5" : "#121212",
    textMuted: pick(seed.textMuted, mix(text, background, 0.42)),
    border: pick(seed.border, mix(surface, text, dark ? 0.14 : 0.1)),
    success: pick(seed.success, dark ? "#34d399" : "#16a34a"),
    warning: pick(seed.warning, dark ? "#fbbf24" : "#d97706"),
    danger: pick(seed.danger, dark ? "#f87171" : "#dc2626"),
  }
  if (contrast(c.onPrimary, c.primary) < 3) c.onPrimary = readableOn(c.primary)
  if (contrast(c.onAccent, c.accent) < 3) c.onAccent = readableOn(c.accent)
  if (contrast(c.textMuted, c.background) < 3.2) c.textMuted = mix(c.text, c.background, 0.3)
  return c
}

/** The theme taken straight from the approved plan's design direction. */
export function baseThemeFromPlan(plan: AppPlan): AppTheme {
  const d = plan.design
  const mode = luminance(d.backgroundColor) < 0.2 ? "dark" : "light"
  return {
    id: "original",
    name: "Original",
    mode,
    radius: d.cornerRadius,
    colors: completeColors(
      { primary: d.primaryColor, accent: d.accentColor, background: d.backgroundColor, surface: d.surfaceColor, text: d.textColor },
      mode
    ),
  }
}

/** A deterministic theme package, used when the AI's package is missing or unusable. */
export function fallbackThemes(plan: AppPlan): AppTheme[] {
  const base = baseThemeFromPlan(plan)
  const p = base.colors.primary
  const darkBg = mix("#0d0f14", p, 0.06)
  return [
    base,
    {
      id: "midnight",
      name: "Midnight",
      mode: "dark",
      radius: base.radius,
      colors: completeColors({ primary: mix(p, "#ffffff", 0.15), accent: base.colors.accent, background: darkBg, text: "#f2f3f5" }, "dark"),
    },
    {
      id: "paper",
      name: "Paper",
      mode: "light",
      radius: base.radius,
      colors: completeColors({ primary: "#1f2328", accent: p, background: "#faf9f6", surface: "#ffffff", text: "#1f2328" }, "light"),
    },
    {
      id: "complement",
      name: "Complement",
      mode: "light",
      radius: base.radius,
      colors: completeColors({ primary: rotate(p, 150), background: "#f7f7f8", surface: "#ffffff", text: "#121417" }, "light"),
    },
  ]
}

/** Validates an AI theme package; the plan's own theme always comes first. */
export function normalizeThemes(raw: unknown, plan: AppPlan): AppTheme[] {
  const list = Array.isArray(raw) ? raw : []
  const base = baseThemeFromPlan(plan)
  // The AI's first theme is its take on the plan's palette: use its finer
  // tokens (muted text, tints, borders) but keep the approved core colors.
  const first = list[0] as { name?: unknown; colors?: Partial<ThemeColors> } | undefined
  if (first?.colors && typeof first.colors === "object") {
    const p = base.colors
    base.colors = completeColors(
      { ...first.colors, primary: p.primary, accent: p.accent, background: p.background, surface: p.surface, text: p.text },
      base.mode
    )
    if (typeof first.name === "string" && first.name.trim()) base.name = first.name.trim().slice(0, 24)
  }
  const out: AppTheme[] = [base]
  const seen = new Set([base.id])
  for (const item of list.slice(1, 8)) {
    if (!item || typeof item !== "object") continue
    const t = item as Record<string, unknown>
    const colors = (t.colors && typeof t.colors === "object" ? t.colors : {}) as Partial<ThemeColors>
    if (!isHex(colors.primary) || !isHex(colors.background) || !isHex(colors.text)) continue
    const mode = t.mode === "dark" || luminance(colors.background) < 0.2 ? "dark" : "light"
    const name = typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 24) : `Theme ${out.length + 1}`
    let id = slugify(typeof t.id === "string" && t.id ? t.id : name)
    if (id === "original" && out.length) id = `${id}-alt`
    while (seen.has(id)) id = `${id}-2`
    seen.add(id)
    out.push({
      id,
      name,
      mode,
      radius: (["sharp", "soft", "round"] as const).includes(t.radius as ThemeRadius) ? (t.radius as ThemeRadius) : base.radius,
      colors: completeColors(colors as Seed, mode),
    })
  }
  if (out.length < 3) {
    for (const f of fallbackThemes(plan).slice(1)) if (!seen.has(f.id)) out.push(f)
  }
  return out.slice(0, 6)
}

/** Every literal color value of a theme, mapped to its variable (for tokenizing generated CSS). */
export function colorTokenMap(t: AppTheme) {
  const map = new Map<string, string>()
  for (const k of THEME_COLOR_KEYS) if (!map.has(t.colors[k])) map.set(t.colors[k].toLowerCase(), `var(${cssVar(k)})`)
  return map
}
