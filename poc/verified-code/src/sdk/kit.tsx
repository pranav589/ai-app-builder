import * as React from "react"
import { Pressable, ScrollView, Switch, Text as RNText, TextInput, View } from "react-native"

import { useTheme, type ColorToken, type Space } from "./theme"

// @app/kit — the component kit. Strict prop types: a wrong or unknown prop is a type error.
// The region between the "props" markers is given to the model verbatim as the kit reference.

// #region props
export type IconName =
  | "plus" | "check" | "close" | "chevron-right" | "chevron-left" | "flame" | "star" | "heart" | "settings"
  | "home" | "chart" | "calendar" | "bell" | "trash" | "edit" | "search" | "user" | "clock"

export type Tone = "default" | "muted" | "primary" | "success" | "danger"

/** Page container. Put one at the root of every screen. Scrolls by default. */
export type ScreenProps = { children?: React.ReactNode; scroll?: boolean; padded?: boolean }
/** Vertical stack. */
export type StackProps = { children?: React.ReactNode; gap?: Space; align?: "start" | "center" | "end" | "stretch" }
/** Horizontal row. */
export type RowProps = { children?: React.ReactNode; gap?: Space; align?: "start" | "center" | "end"; justify?: "start" | "center" | "end" | "between"; wrap?: boolean }
export type TextProps = { children?: React.ReactNode; variant?: "title" | "heading" | "body" | "caption" | "label"; tone?: Tone; align?: "left" | "center" | "right"; numberOfLines?: number }
/** Surface with padding and rounded corners. Pressable when onPress is set. */
export type CardProps = { children?: React.ReactNode; onPress?: () => void; padding?: Space }
export type ButtonProps = { label: string; onPress: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconName; disabled?: boolean; fullWidth?: boolean }
export type IconButtonProps = { icon: IconName; onPress: () => void; label: string; tone?: Tone }
export type ListItemProps = { title: string; subtitle?: string; leading?: React.ReactNode; trailing?: React.ReactNode; onPress?: () => void }
/** A labelled number. */
export type StatProps = { label: string; value: string | number; caption?: string; size?: "sm" | "lg"; tone?: Tone }
/** value is a fraction from 0 to 1. */
export type ProgressBarProps = { value: number; tone?: Tone }
export type TextFieldProps = { label: string; value: string; onChangeText: (text: string) => void; placeholder?: string; keyboard?: "default" | "number" | "email"; multiline?: boolean }
export type ToggleProps = { label: string; value: boolean; onValueChange: (value: boolean) => void; description?: string }
export type EmptyStateProps = { title: string; message?: string; icon?: IconName; action?: { label: string; onPress: () => void } }
export type BadgeProps = { label: string; tone?: Tone }
export type IconProps = { name: IconName; size?: number; tone?: Tone }
export type SectionProps = { title: string; children?: React.ReactNode; action?: { label: string; onPress: () => void } }
export type DividerProps = Record<string, never>
// #endregion props

const GLYPHS: Record<IconName, string> = {
  plus: "+", check: "✓", close: "×", "chevron-right": "›", "chevron-left": "‹", flame: "🔥", star: "★", heart: "♥",
  settings: "⚙", home: "⌂", chart: "▤", calendar: "▦", bell: "🔔", trash: "🗑", edit: "✎", search: "⌕", user: "◉", clock: "◷",
}

function toneColor(tone: Tone | undefined, c: Record<ColorToken, string>) {
  switch (tone) {
    case "muted": return c.textMuted
    case "primary": return c.primary
    case "success": return c.success
    case "danger": return c.danger
    default: return c.text
  }
}

export function Screen({ children, scroll = true, padded = true }: ScreenProps) {
  const t = useTheme()
  const style = { padding: padded ? t.space.lg : 0, gap: t.space.lg }
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: t.colors.background }, style]}>{children}</View>
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={style}>
      {children}
    </ScrollView>
  )
}

const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const

export function Stack({ children, gap = "md", align = "stretch" }: StackProps) {
  const t = useTheme()
  return <View style={{ gap: t.space[gap], alignItems: ALIGN[align] }}>{children}</View>
}

export function Row({ children, gap = "md", align = "center", justify = "start", wrap = false }: RowProps) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: "row", gap: t.space[gap], alignItems: ALIGN[align], justifyContent: JUSTIFY[justify], flexWrap: wrap ? "wrap" : "nowrap" }}>
      {children}
    </View>
  )
}

const TEXT = {
  title: { fontSize: 28, fontWeight: "700" },
  heading: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 16, fontWeight: "400" },
  caption: { fontSize: 13, fontWeight: "400" },
  label: { fontSize: 13, fontWeight: "600" },
} as const

export function Text({ children, variant = "body", tone, align = "left", numberOfLines }: TextProps) {
  const t = useTheme()
  const color = toneColor(tone ?? (variant === "caption" ? "muted" : "default"), t.colors)
  return <RNText numberOfLines={numberOfLines} style={[TEXT[variant], { color, textAlign: align }]}>{children}</RNText>
}

export function Card({ children, onPress, padding = "lg" }: CardProps) {
  const t = useTheme()
  const style = { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.space[padding], gap: t.space.sm }
  if (onPress) return <Pressable accessibilityRole="button" onPress={onPress} style={style}>{children}</Pressable>
  return <View style={style}>{children}</View>
}

export function Button({ label, onPress, variant = "primary", icon, disabled = false, fullWidth = false }: ButtonProps) {
  const t = useTheme()
  const bg = variant === "primary" ? t.colors.primary : variant === "danger" ? t.colors.danger : variant === "secondary" ? t.colors.surface : "transparent"
  const fg = variant === "primary" || variant === "danger" ? t.colors.onPrimary : t.colors.primary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderRadius: t.radius.md, paddingVertical: t.space.md, paddingHorizontal: t.space.lg,
        borderWidth: variant === "secondary" ? 1 : 0, borderColor: t.colors.border, flexDirection: "row", gap: t.space.sm,
        alignItems: "center", justifyContent: "center", alignSelf: fullWidth ? "stretch" : "flex-start",
      }}
    >
      {icon ? <RNText style={{ color: fg, fontSize: 16 }}>{GLYPHS[icon]}</RNText> : null}
      <RNText style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{label}</RNText>
    </Pressable>
  )
}

export function IconButton({ icon, onPress, label, tone = "primary" }: IconButtonProps) {
  const t = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ padding: t.space.sm, borderRadius: t.radius.pill }}>
      <RNText style={{ color: toneColor(tone, t.colors), fontSize: 20 }}>{GLYPHS[icon]}</RNText>
    </Pressable>
  )
}

export function ListItem({ title, subtitle, leading, trailing, onPress }: ListItemProps) {
  const t = useTheme()
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <RNText style={{ color: t.colors.text, fontSize: 16, fontWeight: "500" }}>{title}</RNText>
        {subtitle ? <RNText style={{ color: t.colors.textMuted, fontSize: 13 }}>{subtitle}</RNText> : null}
      </View>
      {trailing ?? (onPress ? <RNText style={{ color: t.colors.textMuted, fontSize: 20 }}>{GLYPHS["chevron-right"]}</RNText> : null)}
    </>
  )
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: t.space.md, paddingVertical: t.space.md, borderBottomWidth: 1, borderColor: t.colors.border }
  if (onPress) return <Pressable accessibilityRole="button" onPress={onPress} style={style}>{body}</Pressable>
  return <View style={style}>{body}</View>
}

export function Stat({ label, value, caption, size = "sm", tone }: StatProps) {
  const t = useTheme()
  return (
    <View style={{ gap: 2 }}>
      <RNText style={{ color: t.colors.textMuted, fontSize: 13, fontWeight: "600" }}>{label}</RNText>
      <RNText style={{ color: toneColor(tone, t.colors), fontSize: size === "lg" ? 34 : 22, fontWeight: "700" }}>{String(value)}</RNText>
      {caption ? <RNText style={{ color: t.colors.textMuted, fontSize: 12 }}>{caption}</RNText> : null}
    </View>
  )
}

export function ProgressBar({ value, tone = "primary" }: ProgressBarProps) {
  const t = useTheme()
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100
  return (
    <View accessibilityRole="progressbar" style={{ height: 8, borderRadius: t.radius.pill, backgroundColor: t.colors.border, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: 8, backgroundColor: toneColor(tone, t.colors) }} />
    </View>
  )
}

export function TextField({ label, value, onChangeText, placeholder, keyboard = "default", multiline = false }: TextFieldProps) {
  const t = useTheme()
  return (
    <View style={{ gap: t.space.xs }}>
      <RNText style={{ color: t.colors.text, fontSize: 13, fontWeight: "600" }}>{label}</RNText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        keyboardType={keyboard === "number" ? "numeric" : keyboard === "email" ? "email-address" : "default"}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: t.space.md, color: t.colors.text, backgroundColor: t.colors.surface, minHeight: multiline ? 96 : undefined }}
      />
    </View>
  )
}

export function Toggle({ label, value, onValueChange, description }: ToggleProps) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.md }}>
      <View style={{ flex: 1 }}>
        <RNText style={{ color: t.colors.text, fontSize: 16 }}>{label}</RNText>
        {description ? <RNText style={{ color: t.colors.textMuted, fontSize: 13 }}>{description}</RNText> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} />
    </View>
  )
}

export function EmptyState({ title, message, icon = "star", action }: EmptyStateProps) {
  const t = useTheme()
  return (
    <View style={{ alignItems: "center", gap: t.space.sm, paddingVertical: t.space.xl }}>
      <RNText style={{ fontSize: 32, color: t.colors.textMuted }}>{GLYPHS[icon]}</RNText>
      <RNText style={{ color: t.colors.text, fontSize: 18, fontWeight: "600" }}>{title}</RNText>
      {message ? <RNText style={{ color: t.colors.textMuted, fontSize: 14, textAlign: "center" }}>{message}</RNText> : null}
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  )
}

export function Badge({ label, tone = "primary" }: BadgeProps) {
  const t = useTheme()
  const c = toneColor(tone, t.colors)
  return (
    <View style={{ borderRadius: t.radius.pill, borderWidth: 1, borderColor: c, paddingHorizontal: t.space.sm, paddingVertical: 2, alignSelf: "flex-start" }}>
      <RNText style={{ color: c, fontSize: 12, fontWeight: "600" }}>{label}</RNText>
    </View>
  )
}

export function Icon({ name, size = 20, tone }: IconProps) {
  const t = useTheme()
  return <RNText style={{ fontSize: size, color: toneColor(tone, t.colors) }}>{GLYPHS[name]}</RNText>
}

export function Section({ title, children, action }: SectionProps) {
  const t = useTheme()
  return (
    <View style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <RNText style={{ color: t.colors.text, fontSize: 18, fontWeight: "600" }}>{title}</RNText>
        {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" /> : null}
      </View>
      {children}
    </View>
  )
}

export function Divider(_props: DividerProps) {
  const t = useTheme()
  return <View style={{ height: 1, backgroundColor: t.colors.border }} />
}
