import { describe, expect, it } from "vitest"
import { normalizeDataModel } from "@app/shared/app-runtime/data-model"
import { fallbackThemes } from "@app/shared/app-runtime/theme"
import { platformFiles } from "@/lib/app-project/templates"
import { MOTION_LEVEL_PATH, MOTION_PATH, motionLevelSource } from "@/lib/app-project/motion"
import { MOTION_EXPORTS, MOTION_PROPS_REFERENCE, PLATFORM_KIT_FILES, platformKitUpdates } from "@/lib/app-project/platform-kits"
import { policyGate } from "@/lib/verify/gates/policy"
import { typecheckGate } from "@/lib/verify/gates/typecheck"
import { renderGate } from "@/lib/verify/gates/render"
import type { AppPlan } from "@app/shared/agent/types"
import type { Workspace } from "@app/shared/verify/types"

const plan: AppPlan = {
  appName: "Motion App",
  summary: "A test app.",
  targetUsers: "Testers.",
  coreFeatures: ["Habits"],
  navigation: "A single tab.",
  design: {
    style: "Clean",
    primaryColor: "#4f46e5",
    accentColor: "#f59e0b",
    backgroundColor: "#f6f7f9",
    surfaceColor: "#ffffff",
    textColor: "#111111",
    cornerRadius: "soft",
    typography: "System",
  },
  screens: [{ id: "home", name: "Home", purpose: "Show habits", keyElements: [], navigatesTo: [], presentation: "tab" }],
}

const data = normalizeDataModel({ collections: [], settings: {}, user: { name: "Alex", email: "alex@example.com" } }, "test-hash")

function workspace(screenCode?: string): Workspace {
  const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t", motion: "expressive" }, data)
  return { files: { ...files, ...PLATFORM_KIT_FILES, ...(screenCode ? { "app/home.tsx": screenCode } : {}) } }
}

// Every primitive, used the way the coder prompt tells the model to, plus raw Reanimated.
const EVERY_PRIMITIVE = `import * as React from "react"
import { FlatList, Text, View } from "react-native"
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated"
import { Screen, Button } from "@/kit"
import { AnimatedNumber, PressableScale, Reveal, SegmentedTabs, Sheet, Skeleton, Stagger, SwipeRow, useMotion } from "@/motion"

const ROWS = [{ id: "a", name: "Run" }, { id: "b", name: "Read" }]

export default function Home() {
  const m = useMotion()
  const [tab, setTab] = React.useState("Day")
  const [open, setOpen] = React.useState(false)
  const lift = useSharedValue(0)
  const lifted = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }), [lift])
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <SegmentedTabs options={["Day", "Week", "Month"]} value={tab} onChange={setTab} />
        <Stagger gap="sm">
          <Text>Streak</Text>
          <AnimatedNumber value={1234.5} decimals={1} prefix="$" />
        </Stagger>
        <Skeleton height={20} />
        <FlatList
          data={ROWS}
          keyExtractor={(r) => r.id}
          scrollEnabled={false}
          renderItem={({ item, index }) => (
            <Reveal index={index}>
              <SwipeRow actions={[{ icon: "trash", label: "Delete", tone: "danger", onPress: () => setOpen(true) }]}>
                <Text>{item.name}</Text>
              </SwipeRow>
            </Reveal>
          )}
        />
        <PressableScale accessibilityLabel="Lift" onPress={() => lift.set(withSpring(lift.get() === 0 ? -8 : 0, m.spring))}>
          <Animated.View style={lifted}><Text>Tile</Text></Animated.View>
        </PressableScale>
        <Button label="Open sheet" onPress={() => setOpen(true)} />
      </Screen>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Pick one">
        <Text>Inside the sheet</Text>
      </Sheet>
    </View>
  )
}
`

const PARALLAX = `import { Text } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { useTheme } from "@/theme"
import { ParallaxScroll, Reveal } from "@/motion"

export default function Home() {
  const t = useTheme()
  return (
    <ParallaxScroll title="Profile" header={<LinearGradient colors={[t.colors.primary, t.colors.accent]} style={{ flex: 1 }} />}>
      <Reveal from="scale"><Text>Alex</Text></Reveal>
    </ParallaxScroll>
  )
}
`

describe("MOTION_SOURCE", () => {
  it("exports every primitive the prompt names", () => {
    for (const name of ["useMotion", "Reveal", "Stagger", "PressableScale", "AnimatedNumber", "Skeleton", "ParallaxScroll", "SwipeRow", "Sheet", "SegmentedTabs"])
      expect(MOTION_EXPORTS).toContain(name)
  })

  it("extracts a props reference with types only", () => {
    expect(MOTION_PROPS_REFERENCE).toContain("export type SwipeRowProps")
    expect(MOTION_PROPS_REFERENCE).not.toContain("#region")
    expect(MOTION_PROPS_REFERENCE).not.toContain("export function")
  })

  it("type-checks against the real Reanimated and gesture-handler types", () => {
    const r = typecheckGate(workspace(), undefined, "motion-test-standalone")
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  })

  it("type-checks and passes policy for a screen using every primitive", () => {
    const ws = workspace(EVERY_PRIMITIVE)
    expect(typecheckGate(ws, undefined, "motion-test-screen").diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(policyGate(ws, ["app/home.tsx"]).ok).toBe(true)
  })

  it("mounts every primitive in the render gate, pressing every button", async () => {
    const r = await renderGate(workspace(EVERY_PRIMITIVE), ["app/home.tsx"])
    expect(r.diagnostics).toEqual([])
    expect(r.ok).toBe(true)
  }, 20000)

  it("mounts ParallaxScroll in the render gate", async () => {
    const r = await renderGate(workspace(PARALLAX), ["app/home.tsx"])
    expect(r.diagnostics).toEqual([])
  }, 20000)
})

describe("platformKitUpdates", () => {
  it("has nothing to update on a freshly built project", () => {
    expect(platformKitUpdates(workspace().files)).toEqual({})
  })

  it("adds both kits and a subtle motion level to a project built before them", () => {
    const { [MOTION_PATH]: _m, [MOTION_LEVEL_PATH]: _l, ...old } = workspace().files
    const updates = platformKitUpdates(old)
    expect(Object.keys(updates).sort()).toEqual([MOTION_LEVEL_PATH, MOTION_PATH].sort())
    expect(updates[MOTION_LEVEL_PATH]).toBe(motionLevelSource("subtle"))
  })

  it("never overwrites the project's own motion level", () => {
    const files = { ...workspace().files, [MOTION_LEVEL_PATH]: motionLevelSource("bold") }
    expect(platformKitUpdates(files)[MOTION_LEVEL_PATH]).toBeUndefined()
  })
})
