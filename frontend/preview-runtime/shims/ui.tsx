// Visual Expo / community packages, rebuilt on react-native-web for the preview.

import * as React from "react"
import * as RN from "react-native-web"
import glyphs from "react-native-vector-icons/glyphmaps/Ionicons.json"
import { previewIcon } from "@app/shared/app-project/icons"

// The device draws its status bar and home indicator over the app.
export const INSETS = { top: 54, bottom: 34, left: 0, right: 0 }
const FRAME = { x: 0, y: 0, width: 390, height: 844 }

// ---------------------------------------------------------------- safe area

type Edge = "top" | "bottom" | "left" | "right"

/** Screens presented as sheets sit below the status bar, so their top inset is 0. */
export const InsetsContext = React.createContext(INSETS)

export function SafeAreaView({ edges, style, mode, ...rest }: { edges?: Edge[] | Record<string, string>; style?: unknown; mode?: string; [k: string]: unknown }) {
  const insets = React.useContext(InsetsContext)
  const list: Edge[] = Array.isArray(edges) ? edges : edges ? (Object.keys(edges) as Edge[]) : ["top", "bottom", "left", "right"]
  const pad = {
    [mode === "margin" ? "marginTop" : "paddingTop"]: list.includes("top") ? insets.top : 0,
    [mode === "margin" ? "marginBottom" : "paddingBottom"]: list.includes("bottom") ? insets.bottom : 0,
  }
  return <RN.View {...rest} style={[{ flex: 1 }, style, pad]} />
}

export const SafeAreaProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>
export const useSafeAreaInsets = () => React.useContext(InsetsContext)
export const useSafeAreaFrame = () => FRAME
export const SafeAreaInsetsContext = InsetsContext
export const initialWindowMetrics = { insets: INSETS, frame: FRAME }
export const SafeAreaFrameContext = React.createContext(FRAME)

export const safeArea = {
  SafeAreaView,
  SafeAreaProvider,
  useSafeAreaInsets,
  useSafeAreaFrame,
  SafeAreaInsetsContext,
  SafeAreaFrameContext,
  initialWindowMetrics,
}

// ---------------------------------------------------------------- icons

const map = glyphs as Record<string, number>

function makeIconFamily(family: string) {
  function Icon({ name, size = 24, color, style, ...rest }: { name: string; size?: number; color?: string; style?: unknown; [k: string]: unknown }) {
    // Only Ionicons ships in the preview; other families fall back to the closest Ionicons glyph.
    const code = map[name] ?? map[`${name}-outline`] ?? map[name?.replace(/-(o|alt)$/, "")] ?? map["ellipse-outline"]
    return (
      <RN.Text
        {...rest}
        selectable={false}
        accessibilityElementsHidden
        style={[{ fontFamily: "Ionicons", fontSize: size, lineHeight: size, color, fontWeight: "normal", fontStyle: "normal" }, style]}
      >
        {String.fromCodePoint(code)}
      </RN.Text>
    )
  }
  Icon.displayName = family
  Icon.glyphMap = map
  return Icon
}

export const icons = {
  Ionicons: makeIconFamily("Ionicons"),
  MaterialIcons: makeIconFamily("MaterialIcons"),
  MaterialCommunityIcons: makeIconFamily("MaterialCommunityIcons"),
  Feather: makeIconFamily("Feather"),
  FontAwesome: makeIconFamily("FontAwesome"),
  FontAwesome5: makeIconFamily("FontAwesome5"),
  FontAwesome6: makeIconFamily("FontAwesome6"),
  AntDesign: makeIconFamily("AntDesign"),
  Entypo: makeIconFamily("Entypo"),
  Octicons: makeIconFamily("Octicons"),
  SimpleLineIcons: makeIconFamily("SimpleLineIcons"),
  EvilIcons: makeIconFamily("EvilIcons"),
}

// ---------------------------------------------------------------- gradient & blur

type Point = { x: number; y: number } | [number, number]
const pt = (p: Point | undefined, d: { x: number; y: number }) => (!p ? d : Array.isArray(p) ? { x: p[0], y: p[1] } : p)

export function LinearGradient({
  colors,
  start,
  end,
  locations,
  style,
  children,
  ...rest
}: {
  colors: string[]
  start?: Point
  end?: Point
  locations?: number[]
  style?: unknown
  children?: React.ReactNode
  [k: string]: unknown
}) {
  const s = pt(start, { x: 0.5, y: 0 })
  const e = pt(end, { x: 0.5, y: 1 })
  const angle = (Math.atan2(e.x - s.x, -(e.y - s.y)) * 180) / Math.PI
  const stops = (colors ?? []).map((c, i) => (locations?.[i] != null ? `${c} ${locations[i] * 100}%` : c)).join(", ")
  return (
    <RN.View {...rest} style={[{ overflow: "hidden" }, style]}>
      {React.createElement("div", {
        "aria-hidden": true,
        style: { position: "absolute", inset: 0, backgroundImage: `linear-gradient(${angle}deg, ${stops})`, pointerEvents: "none" },
      })}
      {children}
    </RN.View>
  )
}

export function BlurView({ tint, intensity = 50, style, children, ...rest }: { tint?: string; intensity?: number; style?: unknown; children?: React.ReactNode; [k: string]: unknown }) {
  const dark = tint === "dark" || tint === "systemMaterialDark" || tint === "systemChromeMaterialDark"
  const a = Math.min(0.85, 0.35 + intensity / 200)
  return (
    <RN.View {...rest} style={[style, { overflow: "hidden" }]}>
      {React.createElement("div", {
        "aria-hidden": true,
        style: {
          position: "absolute",
          inset: 0,
          backdropFilter: `blur(${Math.round(intensity / 4)}px) saturate(1.6)`,
          WebkitBackdropFilter: `blur(${Math.round(intensity / 4)}px) saturate(1.6)`,
          background: dark ? `rgba(20,20,22,${a})` : `rgba(255,255,255,${a})`,
          pointerEvents: "none",
        },
      })}
      {children}
    </RN.View>
  )
}

// ---------------------------------------------------------------- expo-symbols & expo-glass-effect

/** expo-symbols: SF Symbols on iOS / Material Symbols on Android, drawn with the matching Ionicons glyph. */
export function SymbolView({
  name,
  size = 24,
  tintColor,
  type: _type,
  weight: _weight,
  style,
  fallback,
  ...rest
}: {
  name: string | { ios?: string; android?: string; web?: string }
  size?: number
  tintColor?: string
  type?: string
  weight?: string
  style?: unknown
  fallback?: React.ReactNode
  [k: string]: unknown
}) {
  const sf = typeof name === "string" ? name : name.ios
  const md = typeof name === "string" ? name : name.android
  const filled = !!sf && /\.fill$/.test(sf)
  const glyph = previewIcon({ sf, md }, filled) ?? previewIcon({ md }, filled)
  if (!glyph && fallback) return <>{fallback}</>
  const Ion = icons.Ionicons
  return (
    <RN.View {...rest} style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Ion name={glyph ?? "ellipse-outline"} size={size} color={tintColor} />
    </RN.View>
  )
}

/** expo-glass-effect: iOS Liquid Glass, approximated with blur and a light rim. */
export function GlassView({ glassEffectStyle, tintColor, isInteractive: _i, style, children, ...rest }: { glassEffectStyle?: string; tintColor?: string; isInteractive?: boolean; style?: unknown; children?: React.ReactNode; [k: string]: unknown }) {
  const clear = glassEffectStyle === "clear"
  return (
    <RN.View {...rest} style={[style, { overflow: "hidden" }]}>
      {React.createElement("div", {
        "aria-hidden": true,
        style: {
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          backdropFilter: `blur(${clear ? 8 : 20}px) saturate(1.8)`,
          WebkitBackdropFilter: `blur(${clear ? 8 : 20}px) saturate(1.8)`,
          background: tintColor ?? (clear ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.28)"),
          boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,.45), inset 0 1px 0 rgba(255,255,255,.35)",
          pointerEvents: "none",
        },
      })}
      {children}
    </RN.View>
  )
}
export const GlassContainer = ({ style, children, spacing: _s, ...rest }: { style?: unknown; children?: React.ReactNode; spacing?: number; [k: string]: unknown }) => (
  <RN.View {...rest} style={style}>
    {children}
  </RN.View>
)

// ---------------------------------------------------------------- misc

export const StatusBar = () => null
;(StatusBar as unknown as { setBarStyle: () => void }).setBarStyle = () => {}

const FIT: Record<string, string> = { cover: "cover", contain: "contain", fill: "stretch", none: "center", "scale-down": "contain" }

/** expo-image's Image on top of React Native's. */
export function ExpoImage({ source, contentFit, placeholder: _p, transition: _t, style, ...rest }: { source?: unknown; contentFit?: string; placeholder?: unknown; transition?: unknown; style?: unknown; [k: string]: unknown }) {
  const src = typeof source === "string" ? { uri: source } : source
  return <RN.Image {...rest} source={src as never} resizeMode={(FIT[contentFit ?? "cover"] ?? "cover") as never} style={style as never} />
}
