import { compileManifest } from "../compiler/compile"
import type { ChangeSet, FileChange, GateName, JsonPatchOp } from "../core/types"
import { loadFixture } from "../core/workspace"
import { formatDiagnostics, verifyChange, verifyWorkspace } from "../gates/pipeline"

// Deterministic checks of the gates, no model involved: each case is a ChangeSet
// a model could plausibly write, with the gate and code that must reject it.

const base = loadFixture()
const src = (p: string) => base.files[p]
const write = (path: string, content: string): FileChange => ({ path, op: "write", content })
const replaceIn = (path: string, from: string, to: string): FileChange => {
  if (!src(path).includes(from)) throw new Error(`selftest setup: "${from}" not in ${path}`)
  return write(path, src(path).replace(from, to))
}
const cs = (files: FileChange[], manifestPatch: JsonPatchOp[] = []): ChangeSet => ({ intent: "selftest", manifestPatch, files })

const STREAKS = `import { Card, ProgressBar, Screen, Stat, Text } from "@app/kit"
import { useEntries, useHabits } from "@/data"

export default function StreaksScreen() {
  const habits = useHabits()
  const entries = useEntries()
  return (
    <Screen>
      <Text variant="title">Streaks</Text>
      {habits.data.map((h) => {
        const count = entries.data.filter((e) => e.habit === h.id).length
        return (
          <Card key={h.id}>
            <Stat label={h.title} value={count} caption={\`target \${h.target}\`} />
            <ProgressBar value={count / h.target} />
          </Card>
        )
      })}
    </Screen>
  )
}
`
const addStreaksTab: JsonPatchOp[] = [
  { op: "add", path: "/screens/streaks", value: { title: "Streaks", presentation: "tab" } },
  { op: "add", path: "/navigation/tabs/1", value: "streaks" },
]

type Case = { name: string; change: ChangeSet; expect: { gate: GateName; code: string } | "pass" }

const cases: Case[] = [
  { name: "Valid: add a Streaks tab (manifest + screen)", change: cs([write("screens/streaks.tsx", STREAKS)], addStreaksTab), expect: "pass" },
  {
    name: "Valid: targeted edit adds an EmptyState",
    change: {
      intent: "selftest",
      manifestPatch: [],
      files: [
        {
          path: "screens/profile.tsx",
          op: "edit",
          hunks: [{ search: `<Text variant="title">Your progress</Text>`, replace: `<Text variant="title">Your progress</Text>\n      {habits.data.length === 0 ? <EmptyState title="No habits yet" /> : null}` }],
        },
        { path: "screens/profile.tsx", op: "edit", hunks: [{ search: `import { Card, Screen, Stat, Text } from "@app/kit"`, replace: `import { Card, EmptyState, Screen, Stat, Text } from "@app/kit"` }] },
      ],
    },
    expect: "pass",
  },
  { name: "Wrong prop on a kit component", change: cs([replaceIn("screens/home.tsx", 'label="New habit"', 'title="New habit"')]), expect: { gate: "tsc", code: "TS2322" } },
  { name: "Navigate to a screen that doesn't exist", change: cs([replaceIn("screens/home.tsx", 'nav.go("newHabit")', 'nav.go("settings")')]), expect: { gate: "tsc", code: "TS2345" } },
  { name: "Navigate without required params", change: cs([replaceIn("screens/home.tsx", 'nav.go("habitDetail", { id: h.id })', 'nav.go("habitDetail")')]), expect: { gate: "tsc", code: "TS2345" } },
  { name: "Read a field the entity doesn't have", change: cs([replaceIn("screens/home.tsx", "{h.title}</Text>", "{h.title}{h.starred ? \" ★\" : \"\"}</Text>")]), expect: { gate: "tsc", code: "TS2339" } },
  { name: "Use a component without importing it", change: cs([replaceIn("screens/profile.tsx", "<Card>", '<Badge label="Pro" />\n      <Card>')]), expect: { gate: "tsc", code: "TS2304" } },
  { name: "Manifest adds a screen but no file is written", change: cs([], [{ op: "add", path: "/screens/settings", value: { title: "Settings", presentation: "stack" } }]), expect: { gate: "tsc", code: "TS2307" } },
  { name: "Import a package outside the registry", change: cs([replaceIn("screens/profile.tsx", 'import { useEntries', 'import MapView from "react-native-maps"\nimport { useEntries')]), expect: { gate: "policy", code: "import_not_allowed" } },
  { name: "Write a compiler-owned file", change: cs([write("nav/index.ts", "export const hacked = true\n")]), expect: { gate: "policy", code: "compiler_owned" } },
  { name: "Hard-coded color", change: cs([write("components/Banner.tsx", 'import { View } from "react-native"\nexport function Banner() {\n  return <View style={{ backgroundColor: "#ff00aa", height: 4 }} />\n}\n')]), expect: { gate: "policy", code: "literal_color" } },
  { name: "Raw network call", change: cs([write("lib/sync.ts", 'export async function sync() {\n  return fetch("https://example.com/api")\n}\n')]), expect: { gate: "policy", code: "network" } },
  { name: "Screen file with no manifest entry", change: cs([write("screens/settings.tsx", 'import { Screen, Text } from "@app/kit"\nexport default function Settings() {\n  return <Screen><Text>Settings</Text></Screen>\n}\n')]), expect: { gate: "policy", code: "orphan_screen" } },
  { name: "Syntax error (truncated output)", change: cs([write("screens/profile.tsx", src("screens/profile.tsx").slice(0, 300))]), expect: { gate: "parse", code: "syntax" } },
  { name: "Edit whose SEARCH block doesn't match", change: { intent: "selftest", manifestPatch: [], files: [{ path: "screens/home.tsx", op: "edit", hunks: [{ search: "<Header />", replace: "<Header big />" }] }] }, expect: { gate: "parse", code: "edit_no_match" } },
  { name: "Tab in navigation that isn't a screen", change: cs([], [{ op: "add", path: "/navigation/tabs/-", value: "stats" }]), expect: { gate: "manifest", code: "unknown_screen" } },
  { name: "Crash on mount", change: cs([replaceIn("screens/profile.tsx", "const entries = useEntries()", "const entries = useEntries()\n  const latest = entries.data[99].date.slice(0, 4)")]), expect: { gate: "render", code: "render_error" } },
  { name: "Crash when the record doesn't exist", change: cs([replaceIn("screens/habitDetail.tsx", "  if (!habit.data) {", "  const title = habit.data!.title.toUpperCase()\n  if (!habit.data || !title) {")]), expect: { gate: "render", code: "render_error" } },
  { name: "Infinite render loop", change: cs([replaceIn("screens/newHabit.tsx", 'const [target, setTarget] = useState("7")', 'const [target, setTarget] = useState("7")\n  const [, setTick] = useState(0)\n  setTick((n) => n + 1)')]), expect: { gate: "render", code: "render_error" } },
  { name: "Blank screen", change: cs([write("screens/profile.tsx", "export default function ProfileScreen() {\n  return null\n}\n")]), expect: { gate: "render", code: "blank_screen" } },
  { name: "Button that crashes when pressed", change: cs([replaceIn("screens/habitDetail.tsx", "habit.remove()", "habit.remove()\n          ;(undefined as unknown as { x: () => void }).x()")]), expect: { gate: "render", code: "press_error" } },
]

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length))
let failures = 0

console.log("Determinism")
const a = JSON.stringify(compileManifest(base.manifest))
const b = JSON.stringify(compileManifest(structuredClone(base.manifest)))
console.log(`  compile twice -> identical bytes: ${a === b ? "yes" : "NO"}`)
if (a !== b) failures++

console.log("\nBase app")
const baseVerdict = await verifyWorkspace(base)
console.log(`  ${baseVerdict.ok ? "passes" : "FAILS"} all fast gates: ${baseVerdict.results.map((r) => `${r.gate} ${Math.round(r.ms)}ms`).join(", ")}`)
if (!baseVerdict.ok) {
  failures++
  console.log(formatDiagnostics(baseVerdict))
}

console.log(`\n${pad("Case", 48)} ${pad("Expected", 26)} ${pad("Got", 26)} Time`)
for (const c of cases) {
  const t0 = performance.now()
  const v = await verifyChange(base, c.change)
  const ms = Math.round(performance.now() - t0)
  const failed = v.results.find((r) => !r.ok)
  const firstCode = failed?.diagnostics.find((d) => d.code !== "warning")?.code
  const got = v.ok ? "pass" : `${v.failedAt} ${firstCode}`
  const want = c.expect === "pass" ? "pass" : `${c.expect.gate} ${c.expect.code}`
  const match = c.expect === "pass" ? v.ok : v.failedAt === c.expect.gate && failed!.diagnostics.some((d) => d.code === (c.expect as { code: string }).code)
  if (!match) failures++
  console.log(`${match ? "✓" : "✗"} ${pad(c.name, 46)} ${pad(want, 26)} ${pad(got, 26)} ${ms}ms`)
  if (!match || process.argv.includes("--verbose")) console.log("    " + formatDiagnostics(v, 4).replace(/\n/g, "\n    "))
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`)
process.exit(failures ? 1 : 0)
