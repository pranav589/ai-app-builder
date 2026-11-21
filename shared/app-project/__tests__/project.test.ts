import { describe, expect, it } from "vitest"
import { autoImport, checkFile, screenPath } from "@app/shared/app-project/project"

describe("screenPath", () => {
  it("puts tab screens in the (tabs) group", () => {
    expect(screenPath({ id: "home", presentation: "tab" })).toBe("app/(tabs)/home.tsx")
  })

  it("puts stack and modal screens directly under app/", () => {
    expect(screenPath({ id: "details", presentation: "stack" })).toBe("app/details.tsx")
    expect(screenPath({ id: "settings", presentation: "modal" })).toBe("app/settings.tsx")
  })
})

describe("autoImport", () => {
  it("adds an import for a well-known hook that's used but not imported", () => {
    const code = `export default function Home() {\n  const [n, setN] = useState(0)\n  return null\n}`
    const out = autoImport(code)
    expect(out).toContain(`import { useState } from "react"`)
  })

  it("does nothing when everything used is already imported or declared", () => {
    const code = `import { useState } from "react"\nexport default function Home() {\n  const [n] = useState(0)\n  return null\n}`
    expect(autoImport(code)).toBe(code)
  })

  it("merges into an existing import from the same module", () => {
    const code = `import { useState } from "react"\nexport default function Home() {\n  const [n] = useState(0)\n  useEffect(() => {}, [])\n  return null\n}`
    const out = autoImport(code)
    expect(out).toContain(`import { useState, useEffect } from "react"`)
  })

  it("adds a default import for a local component export", () => {
    const code = `export default function Home() {\n  return <Card />\n}`
    const out = autoImport(code, { Card: { module: "@/components/card", isDefault: true } })
    expect(out).toContain(`import Card from "@/components/card"`)
  })

  it("never changes the line count, so preview eids match the stored file", () => {
    const cases = [
      `export default function Home() {
  const [n] = useState(0)
  return <View />
}`,
      `import { Text } from "@/kit"

export default function Home() {
  const [n] = useState(0)
  return <View />
}`,
      `import {
  useState,
} from "react"
export default function Home() {
  useEffect(() => {}, [])
  return <View />
}`,
    ]
    for (const code of cases) {
      const out = autoImport(code)
      expect(out).not.toBe(code)
      expect(out.split("\n").length).toBe(code.split("\n").length)
      expect(out.split("\n").at(-2)).toBe(code.split("\n").at(-2))
    }
    expect(autoImport(cases[2])).toContain("useState, useEffect")
  })

  it("doesn't import a name already declared locally", () => {
    const code = `function useState() { return 1 }\nexport default function Home() {\n  return useState()\n}`
    expect(autoImport(code)).toBe(code)
  })
})

describe("checkFile", () => {
  const files = { "app/home.tsx": "" }

  it("passes a clean screen file", () => {
    const code = `import { View } from "react-native"\nexport default function Home() {\n  return <View />\n}`
    expect(checkFile("app/home.tsx", code, files)).toEqual([])
  })

  it("flags a syntax error", () => {
    const problems = checkFile("app/home.tsx", "export default function( {", files)
    expect(problems[0]).toMatch(/Syntax error/)
  })

  it("flags a missing default export on a route file", () => {
    const problems = checkFile("app/home.tsx", "export function Home() { return null }", files)
    expect(problems).toContain("The file must have a default export (the screen component).")
  })

  it("flags a package outside the allow-list", () => {
    const code = `import { something } from "left-pad"\nexport default function Home() { return null }`
    const problems = checkFile("app/home.tsx", code, files)
    expect(problems.some((p) => p.includes(`Package "left-pad" is not available`))).toBe(true)
  })

  it("flags an unresolved project import", () => {
    const code = `import { Thing } from "@/components/missing"\nexport default function Home() { return null }`
    const problems = checkFile("app/home.tsx", code, files)
    expect(problems.some((p) => p.includes("does not resolve to a file"))).toBe(true)
  })

  it("allows the two platform modules without resolving them", () => {
    const code = `import { useTheme } from "@/theme"\nimport { useCollection } from "@/lib/backend"\nexport default function Home() { return null }`
    expect(checkFile("app/home.tsx", code, files)).toEqual([])
  })

  it("flags more than two hard-coded colors", () => {
    const code = `export default function Home() {\n  const a = "#ff0000"\n  const b = "#00ff00"\n  const c = "#0000ff"\n  return null\n}`
    const problems = checkFile("app/home.tsx", code, files)
    expect(problems.some((p) => p.includes("hard-coded colors"))).toBe(true)
  })

  it("allows pure black/white literals without counting them", () => {
    const code = `export default function Home() {\n  const a = "#ffffff"\n  const b = "#000000"\n  return null\n}`
    expect(checkFile("app/home.tsx", code, files)).toEqual([])
  })
})
