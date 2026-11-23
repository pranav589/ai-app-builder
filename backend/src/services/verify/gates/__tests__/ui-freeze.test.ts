import { describe, expect, it } from "vitest"
import { uiFreezeGate } from "../ui-freeze"
import type { Workspace } from "@app/shared/verify/types"

const SCREEN_BEFORE = `import { Text, View } from "react-native"
import { createStyles } from "@/theme"
import { useTasksStore } from "@/stores/useTasksStore"

const useStyles = createStyles((t) => ({
  wrap: { padding: t.spacing.lg },
  title: { fontSize: 18, color: t.colors.text },
}) as const)

export default function Home() {
  const s = useStyles()
  const tasks = useTasksStore((state) => state.tasks)
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{tasks.length} tasks</Text>
    </View>
  )
}
`

// Only the data-access line changed: same styles, same JSX shape.
const SCREEN_AFTER_OK = `import { Text, View } from "react-native"
import { createStyles } from "@/theme"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

const useStyles = createStyles((t) => ({
  wrap: { padding: t.spacing.lg },
  title: { fontSize: 18, color: t.colors.text },
}) as const)

export default function Home() {
  const s = useStyles()
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks"], queryFn: () => api.get("/collections/tasks").then((r) => r.data) })
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{tasks.length} tasks</Text>
    </View>
  )
}
`

// Adds a new element (a Button) alongside the data-access change -- not allowed.
const SCREEN_AFTER_NEW_ELEMENT = SCREEN_AFTER_OK.replace(
  "<Text style={s.title}>{tasks.length} tasks</Text>",
  '<Text style={s.title}>{tasks.length} tasks</Text>\n      <Text>Extra</Text>'
)

// Changes a style value alongside the data-access change -- not allowed either, even though the JSX shape is identical.
const SCREEN_AFTER_STYLE_CHANGED = SCREEN_AFTER_OK.replace("fontSize: 18", "fontSize: 24")

function ws(files: Record<string, string>): Workspace {
  return { files }
}

describe("uiFreezeGate", () => {
  it("passes when only data-access code changed", () => {
    const r = uiFreezeGate(ws({ "app/home.tsx": SCREEN_AFTER_OK }), ["app/home.tsx"], undefined, ws({ "app/home.tsx": SCREEN_BEFORE }))
    expect(r.ok).toBe(true)
  })

  it("rejects a new JSX element added alongside the data-access change", () => {
    const r = uiFreezeGate(ws({ "app/home.tsx": SCREEN_AFTER_NEW_ELEMENT }), ["app/home.tsx"], undefined, ws({ "app/home.tsx": SCREEN_BEFORE }))
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "jsx_changed")).toBe(true)
  })

  it("rejects a style value change even when the JSX shape is unchanged", () => {
    const r = uiFreezeGate(ws({ "app/home.tsx": SCREEN_AFTER_STYLE_CHANGED }), ["app/home.tsx"], undefined, ws({ "app/home.tsx": SCREEN_BEFORE }))
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "styles_changed")).toBe(true)
  })

  it("ignores a brand-new file (nothing to freeze against)", () => {
    const r = uiFreezeGate(ws({ "stores/useTasksStore.ts": "export {}" }), ["stores/useTasksStore.ts"], undefined, ws({}))
    expect(r.ok).toBe(true)
  })

  it("ignores files outside `changed`", () => {
    const r = uiFreezeGate(
      ws({ "app/home.tsx": SCREEN_AFTER_NEW_ELEMENT, "app/other.tsx": "export default function X() { return null }" }),
      ["app/other.tsx"],
      undefined,
      ws({ "app/home.tsx": SCREEN_BEFORE })
    )
    expect(r.ok).toBe(true)
  })

  it("passes a file with no createStyles at all, unchanged", () => {
    const code = `export default function Home() { return null }`
    const r = uiFreezeGate(ws({ "app/home.tsx": code }), ["app/home.tsx"], undefined, ws({ "app/home.tsx": code }))
    expect(r.ok).toBe(true)
  })
})
