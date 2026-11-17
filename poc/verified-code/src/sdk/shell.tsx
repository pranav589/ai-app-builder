import * as React from "react"
import { Pressable, Text as RNText, View } from "react-native"

import { useNavState } from "./nav-runtime"
import { useTheme } from "./theme"

// @app/shell — the app frame (header, back button, tab bar). Only the generated
// app/routes.tsx uses it; screens are rendered inside it.

export type ScreenMeta = { title: string; presentation: "tab" | "stack" | "modal" }

export function AppShell({
  routes,
  meta,
  tabs,
}: {
  routes: Record<string, React.ComponentType>
  meta: Record<string, ScreenMeta>
  tabs: readonly string[]
}) {
  const t = useTheme()
  const nav = useNavState()
  const current = nav.stack[nav.stack.length - 1]
  const Screen = routes[current.screen]
  const info = meta[current.screen]
  if (!Screen || !info) throw new Error(`No route for screen "${current.screen}".`)
  const showTabs = tabs.length > 0 && info.presentation === "tab"
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm, padding: t.space.md, borderBottomWidth: 1, borderColor: t.colors.border }}>
        {nav.stack.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={nav.back}>
            <RNText style={{ color: t.colors.primary, fontSize: 18 }}>‹ Back</RNText>
          </Pressable>
        ) : null}
        <RNText style={{ color: t.colors.text, fontSize: 17, fontWeight: "600" }}>{info.title}</RNText>
      </View>
      <View testID="screen-body" style={{ flex: 1 }}>
        <Screen />
      </View>
      {showTabs ? (
        <View testID="tab-bar" style={{ flexDirection: "row", borderTopWidth: 1, borderColor: t.colors.border }}>
          {tabs.map((id) => (
            <Pressable key={id} accessibilityRole="tab" onPress={() => nav.switchTab(id)} style={{ flex: 1, padding: t.space.md, alignItems: "center" }}>
              <RNText style={{ color: id === current.screen ? t.colors.primary : t.colors.textMuted }}>{meta[id]?.title ?? id}</RNText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}
