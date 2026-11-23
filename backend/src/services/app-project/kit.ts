// The verified engine's component kit (Phase 7): a small, strictly-typed
// vocabulary of screen primitives so AI-written screens look consistent and
// stop re-deriving spacing/color boilerplate by hand. One real source file,
// used in three places:
//   - the device project: platformFiles() writes KIT_SOURCE to KIT_PATH,
//     alongside theme/index.tsx;
//   - the preview: KIT_PATH is a normal project file, so the existing
//     Sucrase-compiled module loader (preview-runtime/modules.ts
//     resolvePath) resolves "@/kit" to it like any other project file —
//     no separate preview shim needed, since the kit has no device-specific
//     behavior (unlike @/theme, which talks to a different storage key per
//     environment);
//   - the type checker: KIT_PATH is part of the same Workspace FileMap the
//     tsc gate already checks (lib/verify/gates/typecheck.ts), so it is
//     type-checked for free, no separate vendor/type-bundle entry needed.
//
// Adapted from poc/verified-code/src/sdk/kit.tsx: real theme tokens
// (@/theme's useTheme(), not the POC's own theme module) and real
// @expo/vector-icons Ionicons instead of unicode glyphs.
//
// Ownership: kit/** is platform-owned (lib/verify/ownership.ts isPlatformOwned);
// the AI imports from "@/kit" but never writes to it.

export const KIT_PATH = "kit/index.tsx"

export const KIT_SOURCE = `// Platform module: the screen component kit. Screens build their layout
// from these instead of raw View/Text boilerplate, so spacing, color and
// type scale stay consistent across the whole app. Import, never rewrite.
import * as React from "react"
import { Pressable, ScrollView, Switch, Text as RNText, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated"
import { Ionicons } from "@expo/vector-icons"
import { useTheme, type Theme } from "@/theme"
import { PressableScale, useMotion } from "@/motion"

// #region props
export type IconName = React.ComponentProps<typeof Ionicons>["name"]
export type Tone = "default" | "muted" | "primary" | "success" | "warning" | "danger"
export type Space = keyof Theme["spacing"]

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

function toneColor(tone: Tone | undefined, c: Theme["colors"]) {
  switch (tone) {
    case "muted": return c.textMuted
    case "primary": return c.primary
    case "success": return c.success
    case "warning": return c.warning
    case "danger": return c.danger
    default: return c.text
  }
}

export function Screen({ children, scroll = true, padded = true, ...rest }: ScreenProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const base = padded ? t.spacing.lg : 0
  const style = { paddingTop: base + insets.top, paddingBottom: base + insets.bottom, paddingHorizontal: base, gap: t.spacing.lg }
  if (!scroll) return <View {...rest} style={[{ flex: 1, backgroundColor: t.colors.background }, style]}>{children}</View>
  return (
    <ScrollView {...rest} style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={style}>
      {children}
    </ScrollView>
  )
}

const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const

export function Stack({ children, gap = "md", align = "stretch", ...rest }: StackProps) {
  const t = useTheme()
  return <View {...rest} style={{ gap: t.spacing[gap], alignItems: ALIGN[align] }}>{children}</View>
}

export function Row({ children, gap = "md", align = "center", justify = "start", wrap = false, ...rest }: RowProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ flexDirection: "row", gap: t.spacing[gap], alignItems: ALIGN[align], justifyContent: JUSTIFY[justify], flexWrap: wrap ? "wrap" : "nowrap" }}>
      {children}
    </View>
  )
}

const TEXT_VARIANT = {
  title: { fontSize: 28, fontWeight: "700" },
  heading: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 16, fontWeight: "400" },
  caption: { fontSize: 13, fontWeight: "400" },
  label: { fontSize: 13, fontWeight: "600" },
} as const

export function Text({ children, variant = "body", tone, align = "left", numberOfLines, ...rest }: TextProps) {
  const t = useTheme()
  const color = toneColor(tone ?? (variant === "caption" ? "muted" : "default"), t.colors)
  return <RNText {...rest} numberOfLines={numberOfLines} style={[TEXT_VARIANT[variant], { color, textAlign: align }]}>{children}</RNText>
}

export function Card({ children, onPress, padding = "lg", ...rest }: CardProps) {
  const t = useTheme()
  const style = { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing[padding], gap: t.spacing.sm }
  if (onPress) return <PressableScale {...rest} haptic={false} onPress={onPress} style={style}>{children}</PressableScale>
  return <View {...rest} style={style}>{children}</View>
}

export function Button({ label, onPress, variant = "primary", icon, disabled = false, fullWidth = false, ...rest }: ButtonProps) {
  const t = useTheme()
  const bg = variant === "primary" ? t.colors.primary : variant === "danger" ? t.colors.danger : variant === "secondary" ? t.colors.surface : "transparent"
  const fg = variant === "primary" || variant === "danger" ? t.colors.onPrimary : t.colors.primary
  return (
    <PressableScale
      {...rest}
      haptic={false}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: bg,
        borderRadius: t.radius.md,
        paddingVertical: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: t.colors.border,
        flexDirection: "row",
        gap: t.spacing.sm,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: fullWidth ? "stretch" : "flex-start",
      }}
    >
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <RNText style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{label}</RNText>
    </PressableScale>
  )
}

export function IconButton({ icon, onPress, label, tone = "primary", ...rest }: IconButtonProps) {
  const t = useTheme()
  return (
    <Pressable {...rest} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ padding: t.spacing.sm, borderRadius: t.radius.pill }}>
      <Ionicons name={icon} size={20} color={toneColor(tone, t.colors)} />
    </Pressable>
  )
}

export function ListItem({ title, subtitle, leading, trailing, onPress, ...rest }: ListItemProps) {
  const t = useTheme()
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <RNText style={{ color: t.colors.text, fontSize: 16, fontWeight: "500" }}>{title}</RNText>
        {subtitle ? <RNText style={{ color: t.colors.textMuted, fontSize: 13 }}>{subtitle}</RNText> : null}
      </View>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={t.colors.textMuted} /> : null)}
    </>
  )
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: t.spacing.md, paddingVertical: t.spacing.md, borderBottomWidth: 1, borderColor: t.colors.border }
  if (onPress) return <Pressable {...rest} accessibilityRole="button" onPress={onPress} style={style}>{body}</Pressable>
  return <View {...rest} style={style}>{body}</View>
}

export function Stat({ label, value, caption, size = "sm", tone, ...rest }: StatProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ gap: 2 }}>
      <RNText style={{ color: t.colors.textMuted, fontSize: 13, fontWeight: "600" }}>{label}</RNText>
      <RNText style={{ color: toneColor(tone, t.colors), fontSize: size === "lg" ? 34 : 22, fontWeight: "700" }}>{String(value)}</RNText>
      {caption ? <RNText style={{ color: t.colors.textMuted, fontSize: 12 }}>{caption}</RNText> : null}
    </View>
  )
}

// The fill slides in with translateX over the measured track width rather
// than animating its width, so it never re-runs layout per frame.
export function ProgressBar({ value, tone = "primary", ...rest }: ProgressBarProps) {
  const t = useTheme()
  const m = useMotion()
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const [width, setWidth] = React.useState(0)
  const p = useSharedValue(m.reduced ? pct : 0)
  React.useEffect(() => {
    p.set(m.reduced ? pct : withSpring(pct, m.spring))
  }, [p, pct, m.reduced, m.spring])
  const fill = useAnimatedStyle(() => ({ transform: [{ translateX: (Math.min(1, p.get()) - 1) * width }] }), [p, width])
  return (
    <View {...rest} accessibilityRole="progressbar" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 8, borderRadius: t.radius.pill, backgroundColor: t.colors.border, overflow: "hidden" }}>
      <Animated.View style={[{ height: 8, borderRadius: t.radius.pill, backgroundColor: toneColor(tone, t.colors), opacity: width ? 1 : 0 }, fill]} />
    </View>
  )
}

export function TextField({ label, value, onChangeText, placeholder, keyboard = "default", multiline = false, ...rest }: TextFieldProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ gap: t.spacing.xs }}>
      <RNText style={{ color: t.colors.text, fontSize: 13, fontWeight: "600" }}>{label}</RNText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        keyboardType={keyboard === "number" ? "numeric" : keyboard === "email" ? "email-address" : "default"}
        style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, padding: t.spacing.md, color: t.colors.text, backgroundColor: t.colors.surface, minHeight: multiline ? 96 : undefined }}
      />
    </View>
  )
}

export function Toggle({ label, value, onValueChange, description, ...rest }: ToggleProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
      <View style={{ flex: 1 }}>
        <RNText style={{ color: t.colors.text, fontSize: 16 }}>{label}</RNText>
        {description ? <RNText style={{ color: t.colors.textMuted, fontSize: 13 }}>{description}</RNText> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} />
    </View>
  )
}

export function EmptyState({ title, message, icon = "star-outline", action, ...rest }: EmptyStateProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ alignItems: "center", gap: t.spacing.sm, paddingVertical: t.spacing.xl }}>
      <Ionicons name={icon} size={32} color={t.colors.textMuted} />
      <RNText style={{ color: t.colors.text, fontSize: 18, fontWeight: "600" }}>{title}</RNText>
      {message ? <RNText style={{ color: t.colors.textMuted, fontSize: 14, textAlign: "center" }}>{message}</RNText> : null}
      {action ? <Button label={action.label} onPress={action.onPress} /> : null}
    </View>
  )
}

export function Badge({ label, tone = "primary", ...rest }: BadgeProps) {
  const t = useTheme()
  const c = toneColor(tone, t.colors)
  return (
    <View {...rest} style={{ borderRadius: t.radius.pill, borderWidth: 1, borderColor: c, paddingHorizontal: t.spacing.sm, paddingVertical: 2, alignSelf: "flex-start" }}>
      <RNText style={{ color: c, fontSize: 12, fontWeight: "600" }}>{label}</RNText>
    </View>
  )
}

export function Icon({ name, size = 20, tone, ...rest }: IconProps) {
  const t = useTheme()
  return <Ionicons {...rest} name={name} size={size} color={toneColor(tone, t.colors)} />
}

export function Section({ title, children, action, ...rest }: SectionProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <RNText style={{ color: t.colors.text, fontSize: 18, fontWeight: "600" }}>{title}</RNText>
        {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" /> : null}
      </View>
      {children}
    </View>
  )
}

export function Divider({ ...rest }: DividerProps) {
  const t = useTheme()
  return <View {...rest} style={{ height: 1, backgroundColor: t.colors.border }} />
}
`
