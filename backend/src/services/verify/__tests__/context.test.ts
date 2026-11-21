import { describe, expect, it } from "vitest"
import { selectFiles } from "@/lib/verify/context"
import type { Workspace } from "@app/shared/verify/types"

const ws: Workspace = {
  files: {
    "app/home.tsx": `import { View } from "react-native"\nimport { Card } from "@/components/Card"\nimport { formatDate } from "@/lib/date"\nexport default function Home() { return null }\n`,
    "app/profile.tsx": `export default function Profile() { return null }\n`,
    "components/Card.tsx": `export function Card() { return null }\n`,
    "lib/date.ts": `export function formatDate() { return "" }\n`,
    "lib/backend/index.ts": "// platform file, not app-owned",
    "theme/index.tsx": "// platform file, not app-owned",
  },
}

describe("selectFiles", () => {
  it("includes the target plus its local component and lib imports", () => {
    const out = selectFiles(ws, ["app/home.tsx"])
    expect(out.map((f) => f.path).sort()).toEqual(["app/home.tsx", "components/Card.tsx", "lib/date.ts"])
  })

  it("doesn't pull in a sibling screen's imports", () => {
    const out = selectFiles(ws, ["app/profile.tsx"])
    expect(out.map((f) => f.path)).toEqual(["app/profile.tsx"])
  })

  it("supports multiple targets", () => {
    const out = selectFiles(ws, ["app/home.tsx", "app/profile.tsx"])
    expect(out.map((f) => f.path).sort()).toEqual(["app/home.tsx", "app/profile.tsx", "components/Card.tsx", "lib/date.ts"])
  })

  it("falls back to every app-owned file when given no targets", () => {
    const out = selectFiles(ws, [])
    expect(out.map((f) => f.path).sort()).toEqual(["app/home.tsx", "app/profile.tsx", "components/Card.tsx", "lib/date.ts"])
  })

  it("falls back to every app-owned file when the target doesn't exist", () => {
    const out = selectFiles(ws, ["app/missing.tsx"])
    expect(out.map((f) => f.path).sort()).toEqual(["app/home.tsx", "app/profile.tsx", "components/Card.tsx", "lib/date.ts"])
  })
})
