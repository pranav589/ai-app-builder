// The motion kit (@/motion): spring-based, gesture-driven animation
// primitives on Reanimated 4 + gesture-handler 3. Ships exactly like @/kit
// (see kit.ts for how a platform source file reaches the device project, the
// preview and the type checker); platform-kits.ts keeps both in sync.
//
// Its feel scales with the app's motion level, which the foundation step
// picks and platformFiles writes to MOTION_LEVEL_PATH as its own small file,
// so MOTION_SOURCE itself stays a constant.
//
// It runs in two very different places. On device, the worklets Babel plugin
// turns hook and gesture callbacks into UI-thread worklets, so anything that
// must run on the JS thread from inside one (setState, haptics, onClose) goes
// through scheduleOnRN. The preview compiles with Sucrase instead, where
// Reanimated only tracks shared values listed in a dependency array -- so
// every reactive hook here passes one (the policy gate holds app code to the
// same rule). It's String.raw: no backticks or dollar-brace in the source.

import type { MotionLevel } from "@app/shared/app-runtime/theme"

export const MOTION_PATH = "motion/index.tsx"
export const MOTION_LEVEL_PATH = "motion/level.ts"

export const motionLevelSource = (level: MotionLevel) =>
  `// Platform file: how much motion this app uses, picked with its design.\nexport type MotionLevel = "subtle" | "expressive" | "bold"\nexport const MOTION_LEVEL: MotionLevel = ${JSON.stringify(level)}\n`

export const MOTION_SOURCE = String.raw`// Platform module: the motion kit. Spring physics, gesture-driven rows and
// sheets, scroll-linked headers and count-ups, tuned to the app's motion level
// (motion/level.ts) and to the system reduce-motion setting. Import, never rewrite.
import * as React from "react"
import { Pressable, StyleSheet, Text as RNText, View, useWindowDimensions, type DimensionValue, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from "react-native"
import Animated, { Easing, Extrapolation, cancelAnimation, interpolate, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"
import { GestureDetector, GestureStateManager, usePanGesture } from "react-native-gesture-handler"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import { useTheme, type Theme } from "@/theme"
import { MOTION_LEVEL, type MotionLevel } from "./level"

// #region props
export type MotionIconName = React.ComponentProps<typeof Ionicons>["name"]
export type SpringConfig = { damping: number; stiffness: number; mass: number }
/** The app's motion tokens, for raw Reanimated code: withSpring(to, m.spring), withTiming(to, { duration: m.duration }). reduced: the user asked the system for less motion, so skip movement. */
export type MotionTokens = { level: MotionLevel; reduced: boolean; spring: SpringConfig; bouncy: SpringConfig; duration: number; distance: number; stagger: number; pressScale: number }
/** Fades + slides (or scales) its children in on mount. In a FlatList pass renderItem's index to stagger rows. */
export type RevealProps = { children?: React.ReactNode; from?: "up" | "down" | "left" | "right" | "scale" | "fade"; delay?: number; index?: number; style?: StyleProp<ViewStyle> }
/** A vertical stack that reveals its children one after another. */
export type StaggerProps = { children?: React.ReactNode; from?: RevealProps["from"]; gap?: keyof Theme["spacing"] }
/** Pressable that springs down on touch, with a light haptic on press. Use for custom tappable cards, tiles and chips. */
export type PressableScaleProps = { children?: React.ReactNode; onPress?: () => void; onLongPress?: () => void; disabled?: boolean; haptic?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle> }
/** A number that counts to its value (and re-counts when it changes). */
export type AnimatedNumberProps = { value: number; decimals?: number; prefix?: string; suffix?: string; style?: StyleProp<TextStyle> }
/** A pulsing placeholder block for loading states. */
export type SkeletonProps = { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }
/** A screen-filling scroll view with a full-bleed header (an Image or LinearGradient) that parallaxes away, stretches with a springy rubber-band when pulled down from the top, and a compact title bar that fades in once it scrolls off. For detail and profile screens without a navigation header. */
export type ParallaxScrollProps = { header: React.ReactNode; headerHeight?: number; title?: string; children?: React.ReactNode }
export type SwipeAction = { icon: MotionIconName; label: string; onPress: () => void; tone?: "primary" | "success" | "warning" | "danger" }
/** A list row that swipes left to reveal actions (iOS style). */
export type SwipeRowProps = { children?: React.ReactNode; actions: SwipeAction[] }
/** An in-screen bottom sheet: springs up when visible, closes on a drag down or a tap on the scrim. Render it last in the screen's root view. */
export type SheetProps = { visible: boolean; onClose: () => void; title?: string; children?: React.ReactNode }
/** A segmented control whose selection pill slides between options. */
export type SegmentedTabsProps = { options: string[]; value: string; onChange: (value: string) => void }
// #endregion props

const LEVELS: Record<MotionLevel, Omit<MotionTokens, "level" | "reduced">> = {
  subtle: { spring: { damping: 26, stiffness: 280, mass: 1 }, bouncy: { damping: 20, stiffness: 260, mass: 1 }, duration: 220, distance: 8, stagger: 35, pressScale: 0.98 },
  expressive: { spring: { damping: 20, stiffness: 220, mass: 1 }, bouncy: { damping: 13, stiffness: 190, mass: 1 }, duration: 320, distance: 18, stagger: 55, pressScale: 0.96 },
  bold: { spring: { damping: 16, stiffness: 170, mass: 1 }, bouncy: { damping: 10, stiffness: 150, mass: 1 }, duration: 420, distance: 32, stagger: 75, pressScale: 0.93 },
}

export function useMotion(): MotionTokens {
  const reduced = useReducedMotion()
  return { ...LEVELS[MOTION_LEVEL], level: MOTION_LEVEL, reduced }
}

// Past this many rows a list stops waiting longer: row 30 shouldn't appear seconds late.
const MAX_STAGGER = 8

export function Reveal({ children, from = "up", delay = 0, index, style, ...rest }: RevealProps) {
  const m = useMotion()
  const wait = delay + (index === undefined ? 0 : Math.min(index, MAX_STAGGER) * m.stagger)
  const p = useSharedValue(m.reduced ? 1 : 0)
  React.useEffect(() => {
    if (!m.reduced) p.set(withDelay(wait, withSpring(1, m.spring)))
  }, [p, wait, m.reduced, m.spring])
  const d = m.distance
  const anim = useAnimatedStyle(() => {
    const v = p.get()
    const off = (1 - v) * d
    if (from === "scale") return { opacity: Math.min(v, 1), transform: [{ scale: 0.92 + 0.08 * v }] }
    if (from === "left" || from === "right") return { opacity: Math.min(v, 1), transform: [{ translateX: from === "left" ? -off : off }] }
    return { opacity: Math.min(v, 1), transform: [{ translateY: from === "up" ? off : from === "down" ? -off : 0 }] }
  }, [p, from, d])
  return <Animated.View {...rest} style={[style, anim]}>{children}</Animated.View>
}

export function Stagger({ children, from, gap = "md", ...rest }: StaggerProps) {
  const t = useTheme()
  return (
    <View {...rest} style={{ gap: t.spacing[gap] }}>
      {React.Children.toArray(children).map((child, i) => (
        <Reveal key={React.isValidElement(child) && child.key !== null ? child.key : i} from={from} index={i}>{child}</Reveal>
      ))}
    </View>
  )
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function PressableScale({ children, onPress, onLongPress, disabled = false, haptic = true, accessibilityLabel, style, ...rest }: PressableScaleProps) {
  const m = useMotion()
  const s = useSharedValue(1)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }] }), [s])
  const to = (v: number) => {
    if (!m.reduced) s.set(withSpring(v, m.bouncy))
  }
  const press = onPress
    ? () => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onPress()
      }
    : undefined
  return (
    <AnimatedPressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={() => to(m.pressScale)}
      onPressOut={() => to(1)}
      onPress={press}
      onLongPress={onLongPress}
      style={[style, anim, disabled ? { opacity: 0.5 } : null]}
    >
      {children}
    </AnimatedPressable>
  )
}

export function AnimatedNumber({ value, decimals = 0, prefix = "", suffix = "", style, ...rest }: AnimatedNumberProps) {
  const t = useTheme()
  const m = useMotion()
  const safe = Number.isFinite(value) ? value : 0
  const v = useSharedValue(m.reduced ? safe : 0)
  const [shown, setShown] = React.useState(m.reduced ? safe : 0)
  React.useEffect(() => {
    v.set(m.reduced ? safe : withTiming(safe, { duration: m.duration * 3, easing: Easing.out(Easing.cubic) }))
  }, [v, safe, m.reduced, m.duration])
  const f = Math.pow(10, decimals)
  // Rounded first, so React re-renders only when the visible digits change.
  useAnimatedReaction(() => Math.round(v.get() * f) / f, (cur, prev) => {
    if (cur !== prev) scheduleOnRN(setShown, cur)
  }, [v, f])
  const text = prefix + shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix
  return <RNText {...rest} style={[{ color: t.colors.text, fontVariant: ["tabular-nums"] }, style]}>{text}</RNText>
}

export function Skeleton({ width = "100%", height = 16, radius, style, ...rest }: SkeletonProps) {
  const t = useTheme()
  const m = useMotion()
  const o = useSharedValue(1)
  React.useEffect(() => {
    if (m.reduced) return
    o.set(withRepeat(withSequence(withTiming(0.45, { duration: 700 }), withTiming(1, { duration: 700 })), -1))
    return () => cancelAnimation(o)
  }, [o, m.reduced])
  const anim = useAnimatedStyle(() => ({ opacity: o.get() }), [o])
  return <Animated.View {...rest} style={[{ width, height, borderRadius: radius ?? t.radius.sm, backgroundColor: t.colors.surfaceAlt }, style, anim]} />
}

export function ParallaxScroll({ header, headerHeight = 300, title, children, ...rest }: ParallaxScrollProps) {
  const t = useTheme()
  const m = useMotion()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const y = useSharedValue(0)
  const pull = useSharedValue(0)
  const startY = useSharedValue(0)
  const decided = useSharedValue(false)
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => y.set(e.contentOffset.y) }, [y])
  const h = headerHeight
  const bouncy = m.bouncy
  // Always enough room to scroll the header fully under the title bar: with
  // only a little content the screen barely scrolls, and the parallax and the
  // title bar would never get to play.
  const minContent = height + h - (insets.top + 48)
  // The pull-down stretch is a gesture of its own: Android's scroll view never
  // scrolls past its top and iOS's bounce can't be sprung by us, so bounces
  // and the overscroll glow are off and this behaves the same on both. It
  // decides on a drag's first 8pt: at the top and moving down it takes over
  // (rubber-banding the pull, then springing back); otherwise it steps aside
  // and the scroll view scrolls as usual. pan-y keeps touch scrolling native
  // on the web, where a drag with a mouse still stretches it.
  const pan = usePanGesture({
    manualActivation: true,
    enabled: !m.reduced,
    touchAction: "pan-y",
    onTouchesDown: (e) => {
      startY.set(e.allTouches[0].absoluteY)
      decided.set(false)
    },
    onTouchesMove: (e) => {
      if (decided.get()) return
      const dy = e.allTouches[0].absoluteY - startY.get()
      if (Math.abs(dy) < 8) return
      decided.set(true)
      if (dy > 0 && y.get() <= 0) GestureStateManager.activate(e.handlerTag)
      else GestureStateManager.fail(e.handlerTag)
    },
    onUpdate: (e) => pull.set(Math.min(h * 0.7, Math.max(0, e.translationY) * 0.5)),
    onFinalize: () => pull.set(withSpring(0, bouncy)),
  })
  const headerAnim = useAnimatedStyle(() => {
    const v = y.get()
    const p = pull.get()
    return {
      transform: [
        { translateY: interpolate(v, [-h, 0, h], [-h / 2, 0, h * 0.6]) + p / 2 },
        { scale: interpolate(v, [-h, 0, h], [2, 1, 1]) * (1 + p / h) },
      ],
    }
  }, [y, pull, h])
  const bodyAnim = useAnimatedStyle(() => ({ transform: [{ translateY: pull.get() }] }), [pull])
  const fadeAt = h - insets.top - 56
  const barAnim = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [fadeAt - 48, fadeAt], [0, 1], Extrapolation.CLAMP) }), [y, fadeAt])
  return (
    <View {...rest} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <GestureDetector gesture={pan}>
        <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} bounces={false} overScrollMode="never" contentContainerStyle={{ minHeight: minContent, paddingBottom: insets.bottom + t.spacing.xl }}>
          <Animated.View style={[{ height: h }, headerAnim]}>{header}</Animated.View>
          <Animated.View style={[{ flexGrow: 1 }, bodyAnim]}>
            <View style={{ flexGrow: 1, marginTop: -t.radius.xl, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, backgroundColor: t.colors.background, padding: t.spacing.lg, gap: t.spacing.lg }}>
              {children}
            </View>
          </Animated.View>
        </Animated.ScrollView>
      </GestureDetector>
      {title ? (
        <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top, height: insets.top + 48, alignItems: "center", justifyContent: "center", backgroundColor: t.colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border, pointerEvents: "none" }, barAnim]}>
          <RNText numberOfLines={1} style={{ color: t.colors.text, fontSize: 17, fontWeight: "600" }}>{title}</RNText>
        </Animated.View>
      ) : null}
    </View>
  )
}

const ACTION_WIDTH = 76

export function SwipeRow({ children, actions, ...rest }: SwipeRowProps) {
  const t = useTheme()
  const m = useMotion()
  const open = -ACTION_WIDTH * actions.length
  const x = useSharedValue(0)
  const start = useSharedValue(0)
  const tick = () => void Haptics.selectionAsync()
  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onActivate: () => start.set(x.get()),
    onUpdate: (e) => x.set(Math.min(0, Math.max(open * 1.2, start.get() + e.translationX))),
    onDeactivate: (e) => {
      const opening = e.velocityX < -400 || (e.velocityX < 400 && x.get() < open / 2)
      x.set(withSpring(opening ? open : 0, m.spring))
      if (opening) scheduleOnRN(tick)
    },
  })
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }), [x])
  const tone = (a: SwipeAction) => (a.tone === "danger" ? t.colors.danger : a.tone === "warning" ? t.colors.warning : a.tone === "success" ? t.colors.success : t.colors.primary)
  return (
    <View {...rest} style={{ overflow: "hidden", borderRadius: t.radius.lg }}>
      <View style={{ position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row" }}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => {
              x.set(withSpring(0, m.spring))
              a.onPress()
            }}
            style={{ width: ACTION_WIDTH, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tone(a) }}
          >
            <Ionicons name={a.icon} size={20} color={t.colors.onPrimary} />
            <RNText style={{ color: t.colors.onPrimary, fontSize: 12, fontWeight: "600" }}>{a.label}</RNText>
          </Pressable>
        ))}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: t.colors.surface }, row]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  )
}

export function Sheet({ visible, onClose, title, children, ...rest }: SheetProps) {
  const t = useTheme()
  const m = useMotion()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const y = useSharedValue(visible ? 0 : height)
  React.useEffect(() => {
    y.set(visible ? (m.reduced ? 0 : withSpring(0, m.spring)) : withTiming(height, { duration: m.duration }))
  }, [y, visible, height, m.reduced, m.spring, m.duration])
  // The whole panel drags, but only once a finger moves down past 12pt, so
  // taps on its fields and buttons and upward scrolls still reach them.
  const drag = usePanGesture({
    activeOffsetY: 12,
    failOffsetX: [-20, 20],
    onUpdate: (e) => y.set(Math.max(0, e.translationY)),
    onDeactivate: (e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        y.set(withTiming(height, { duration: m.duration }))
        scheduleOnRN(onClose)
      } else y.set(withSpring(0, m.spring))
    },
  })
  const scrim = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [0, height], [1, 0], Extrapolation.CLAMP) }), [y, height])
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }), [y])
  return (
    <View {...rest} style={[StyleSheet.absoluteFill, { zIndex: 10, pointerEvents: visible ? "box-none" : "none" }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }, scrim]}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <GestureDetector gesture={drag}>
        <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: height * 0.9, backgroundColor: t.colors.surface, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, paddingHorizontal: t.spacing.lg, paddingBottom: insets.bottom + t.spacing.lg, gap: t.spacing.md, boxShadow: "0 -8px 30px rgba(0,0,0,0.12)" }, panel]}>
          <View style={{ alignItems: "center", paddingTop: t.spacing.sm, paddingBottom: t.spacing.xs, gap: t.spacing.sm }}>
            <View style={{ width: 36, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.border }} />
            {title ? <RNText style={{ color: t.colors.text, fontSize: 17, fontWeight: "600" }}>{title}</RNText> : null}
          </View>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

export function SegmentedTabs({ options, value, onChange, ...rest }: SegmentedTabsProps) {
  const t = useTheme()
  const m = useMotion()
  const [width, setWidth] = React.useState(0)
  const seg = options.length ? width / options.length : 0
  const target = Math.max(0, options.indexOf(value)) * seg
  const x = useSharedValue(0)
  React.useEffect(() => {
    x.set(m.reduced ? target : withSpring(target, m.spring))
  }, [x, target, m.reduced, m.spring])
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }), [x])
  return (
    <View {...rest} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 8)} style={{ flexDirection: "row", padding: 4, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceAlt }}>
      {seg > 0 ? <Animated.View style={[{ position: "absolute", top: 4, bottom: 4, left: 4, width: seg, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }, pill]} /> : null}
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          accessibilityState={{ selected: o === value }}
          onPress={() => {
            void Haptics.selectionAsync()
            onChange(o)
          }}
          style={{ flex: 1, paddingVertical: 8, alignItems: "center" }}
        >
          <RNText style={{ color: o === value ? t.colors.text : t.colors.textMuted, fontSize: 14, fontWeight: "600" }}>{o}</RNText>
        </Pressable>
      ))}
    </View>
  )
}
`
