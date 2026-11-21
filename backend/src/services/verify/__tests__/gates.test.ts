import { describe, expect, it } from "vitest"
import { parseGate } from "@/lib/verify/gates/parse"
import { policyGate } from "@/lib/verify/gates/policy"
import type { Workspace } from "@app/shared/verify/types"

const ws = (files: Record<string, string>): Workspace => ({ files })

describe("parseGate", () => {
  it("passes valid TSX", () => {
    const r = parseGate(ws({ "app/home.tsx": "export default function Home() {\n  return null\n}\n" }))
    expect(r.ok).toBe(true)
  })

  it("flags a syntax error", () => {
    const r = parseGate(ws({ "app/home.tsx": "export default function( {" }))
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0].code).toBe("syntax")
  })

  it("ignores files outside the app-owned paths", () => {
    const r = parseGate(ws({ "theme/index.tsx": "export default function( {" }))
    expect(r.ok).toBe(true)
  })
})

describe("policyGate", () => {
  const files = { "app/home.tsx": "" }

  it("passes a clean file", () => {
    const code = `import { View } from "react-native"\nexport default function Home() {\n  return <View />\n}\n`
    const r = policyGate(ws({ ...files, "app/home.tsx": code }))
    expect(r.ok).toBe(true)
  })

  it("flags a disallowed package", () => {
    const code = `import { pad } from "left-pad"\nexport default function Home() { return null }`
    const r = policyGate(ws({ "app/home.tsx": code }))
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "import_not_allowed")).toBe(true)
  })

  it("flags an unresolved project import", () => {
    const code = `import { Thing } from "@/components/missing"\nexport default function Home() { return null }`
    const r = policyGate(ws({ "app/home.tsx": code }))
    expect(r.diagnostics.some((d) => d.code === "import_not_resolved")).toBe(true)
  })

  it("allows the platform modules", () => {
    const code = `import { useTheme } from "@/theme"\nimport { useCollection } from "@/lib/backend"\nexport default function Home() { return null }`
    const r = policyGate(ws({ "app/home.tsx": code }))
    expect(r.ok).toBe(true)
  })

  it("flags a missing default export on a route file", () => {
    const r = policyGate(ws({ "app/home.tsx": "export function Home() { return null }" }))
    expect(r.diagnostics.some((d) => d.code === "missing_default_export")).toBe(true)
  })

  it("flags a raw fetch call", () => {
    const code = `export default function Home() {\n  fetch("https://example.com")\n  return null\n}`
    const r = policyGate(ws({ "app/home.tsx": code }))
    expect(r.diagnostics.some((d) => d.code === "network")).toBe(true)
  })

  it("flags eval", () => {
    const code = `export default function Home() {\n  eval("1+1")\n  return null\n}`
    const r = policyGate(ws({ "app/home.tsx": code }))
    expect(r.diagnostics.some((d) => d.code === "eval")).toBe(true)
  })

  it("flags a file over the line limit", () => {
    const code = "export default function Home() {\n" + "  const x = 1\n".repeat(300) + "}\n"
    const r = policyGate(ws({ "app/home.tsx": code }))
    expect(r.diagnostics.some((d) => d.code === "file_too_long")).toBe(true)
  })

  it("warns (but doesn't block) on more than two hard-coded colors", () => {
    const code = `export default function Home() {\n  const a = "#ff0000"\n  const b = "#00ff00"\n  const c = "#0000ff"\n  return null\n}`
    const r = policyGate(ws({ "app/home.tsx": code }))
    const d = r.diagnostics.find((d) => d.code === "literal_color")
    expect(d?.severity).toBe("warning")
    expect(r.ok).toBe(true)
  })

  it("ignores violations in files this change didn't touch", () => {
    const tooLong = "export default function Old() {\n" + "  const x = 1\n".repeat(300) + "}\n"
    const edited = `import { View } from "react-native"\nexport default function Home() {\n  return <View />\n}\n`
    const r = policyGate(ws({ "app/old.tsx": tooLong, "app/home.tsx": edited }), ["app/home.tsx"])
    expect(r.ok).toBe(true)
  })

  it("still checks a changed file even when other files are also in scope", () => {
    const tooLong = "export default function Old() {\n" + "  const x = 1\n".repeat(300) + "}\n"
    const r = policyGate(ws({ "app/old.tsx": tooLong }), ["app/old.tsx"])
    expect(r.ok).toBe(false)
  })

  it("doesn't block a file that was already over the limit before this edit, as long as it didn't grow", () => {
    const tooLong = "export default function Old() {\n" + "  const x = 1\n".repeat(300) + "}\n"
    const sameLength = tooLong.replace("x = 1", "x = 2")
    const r = policyGate(ws({ "app/old.tsx": sameLength }), ["app/old.tsx"], undefined, ws({ "app/old.tsx": tooLong }))
    expect(r.diagnostics.some((d) => d.code === "file_too_long")).toBe(false)
  })

  it("still blocks a file already over the limit if the edit makes it longer", () => {
    const tooLong = "export default function Old() {\n" + "  const x = 1\n".repeat(300) + "}\n"
    const longer = tooLong + "  const y = 2\n"
    const r = policyGate(ws({ "app/old.tsx": longer }), ["app/old.tsx"], undefined, ws({ "app/old.tsx": tooLong }))
    expect(r.diagnostics.some((d) => d.code === "file_too_long")).toBe(true)
  })

  it("blocks a brand-new file over the limit even with no base to compare against", () => {
    const tooLong = "export default function New() {\n" + "  const x = 1\n".repeat(300) + "}\n"
    const r = policyGate(ws({ "app/new.tsx": tooLong }), ["app/new.tsx"], undefined, ws({}))
    expect(r.diagnostics.some((d) => d.code === "file_too_long")).toBe(true)
  })
})
