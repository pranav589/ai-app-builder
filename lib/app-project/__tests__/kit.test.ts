import { describe, expect, it } from "vitest"
import { normalizeDataModel } from "@/lib/app-runtime/data-model"
import { fallbackThemes } from "@/lib/app-runtime/theme"
import { platformFiles } from "@/lib/app-project/templates"
import { KIT_EXPORTS, KIT_PATH, KIT_PROPS_REFERENCE, KIT_SOURCE } from "@/lib/app-project/kit"
import { typecheckGate } from "@/lib/verify/gates/typecheck"
import { renderGate } from "@/lib/verify/gates/render"
import type { AppPlan } from "@/lib/agent/types"
import type { Workspace } from "@/lib/verify/types"

const plan: AppPlan = {
  appName: "Test App",
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

function baseWorkspace(screenCode: string): Workspace {
  const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t" }, data)
  return { files: { ...files, [KIT_PATH]: KIT_SOURCE, "app/home.tsx": screenCode } }
}

describe("KIT_SOURCE", () => {
  it("defines the full component set", () => {
    const expected = [
      "IconName", "Tone", "Space", "ScreenProps", "StackProps", "RowProps", "TextProps", "CardProps", "ButtonProps", "IconButtonProps",
      "ListItemProps", "StatProps", "ProgressBarProps", "TextFieldProps", "ToggleProps", "EmptyStateProps", "BadgeProps", "IconProps",
      "SectionProps", "DividerProps",
      "Screen", "Stack", "Row", "Text", "Card", "Button", "IconButton", "ListItem", "Stat", "ProgressBar", "TextField", "Toggle",
      "EmptyState", "Badge", "Icon", "Section", "Divider",
    ]
    for (const name of expected) expect(KIT_EXPORTS).toContain(name)
  })

  it("extracts a non-empty props reference bounded by the region markers", () => {
    expect(KIT_PROPS_REFERENCE).toContain("export type ButtonProps")
    expect(KIT_PROPS_REFERENCE).not.toContain("#region")
    expect(KIT_PROPS_REFERENCE).not.toContain("export function")
  })

  it("type-checks cleanly on its own (no screen referencing it)", () => {
    const files = platformFiles(plan, { themes: fallbackThemes(plan), activeId: "original", hash: "t" }, data)
    const ws: Workspace = { files: { ...files, [KIT_PATH]: KIT_SOURCE } }
    const r = typecheckGate(ws, undefined, "kit-test-standalone")
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  })

  it("type-checks a screen that uses every component correctly", () => {
    const code = `import * as React from "react"
import { Screen, Stack, Row, Text, Card, Button, IconButton, ListItem, Stat, ProgressBar, TextField, Toggle, EmptyState, Badge, Icon, Section, Divider } from "@/kit"

export default function Home() {
  const [name, setName] = React.useState("")
  return (
    <Screen>
      <Section title="Overview" action={{ label: "See all", onPress: () => {} }}>
        <Stack gap="md">
          <Row justify="between">
            <Text variant="title">Hi there</Text>
            <Badge label="New" tone="primary" />
          </Row>
          <Card onPress={() => {}}>
            <Stat label="Streak" value={3} caption="days" tone="success" />
            <ProgressBar value={0.4} />
          </Card>
          <ListItem title="Habit" subtitle="Daily" trailing={<Icon name="star" tone="warning" />} onPress={() => {}} />
          <TextField label="Name" value={name} onChangeText={setName} />
          <Toggle label="Reminders" value={true} onValueChange={() => {}} />
          <Divider />
          <EmptyState title="Nothing yet" icon="star-outline" action={{ label: "Add", onPress: () => {} }} />
          <Row gap="sm">
            <Button label="Save" onPress={() => {}} icon="checkmark" />
            <IconButton icon="trash" label="Delete" onPress={() => {}} tone="danger" />
          </Row>
        </Stack>
      </Section>
    </Screen>
  )
}
`
    const r = typecheckGate(baseWorkspace(code), undefined, "kit-test-screen")
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  })

  it("actually mounts in the render gate without crashing", async () => {
    const code = `import { Screen, Stack, Row, Text, Card, Button, Stat, ProgressBar, Badge, Divider } from "@/kit"

export default function Home() {
  return (
    <Screen>
      <Stack gap="md">
        <Row justify="between">
          <Text variant="title">Hi there</Text>
          <Badge label="New" />
        </Row>
        <Card>
          <Stat label="Streak" value={3} caption="days" />
          <ProgressBar value={0.4} />
        </Card>
        <Divider />
        <Button label="Save" onPress={() => {}} />
      </Stack>
    </Screen>
  )
}
`
    const r = await renderGate(baseWorkspace(code), ["app/home.tsx"])
    expect(r.ok).toBe(true)
  }, 15000)

  it("rejects an unknown icon name and a wrong prop", () => {
    const code = `import { Screen, Button, Icon } from "@/kit"

export default function Home() {
  return (
    <Screen>
      <Icon name="not-a-real-icon" />
      <Button label="Go" onPress={() => {}} variant="huge" />
    </Screen>
  )
}
`
    const r = typecheckGate(baseWorkspace(code), undefined, "kit-test-screen-bad")
    const errors = r.diagnostics.filter((d) => d.severity === "error")
    expect(errors.length).toBeGreaterThan(0)
  })
})
