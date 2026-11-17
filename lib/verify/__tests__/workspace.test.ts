import { describe, expect, it } from "vitest"
import { applyChangeSet, docFromWorkspace, workspaceFromDoc } from "@/lib/verify/workspace"
import type { ChangeSet } from "@/lib/verify/types"
import type { AppDoc } from "@/lib/app-runtime/app-doc"

const cs = (overrides: Partial<ChangeSet>): ChangeSet => ({ intent: "test", manifestPatch: [], files: [], ...overrides })

describe("applyChangeSet", () => {
  const base = { files: { "app/home.tsx": "export default function Home() {\n  return null\n}\n" } }

  it("writes a new file", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "components/Card.tsx", op: "write", content: "export const Card = () => null\n" }] }))
    expect(r.diagnostics).toEqual([])
    expect(r.ws?.files["components/Card.tsx"]).toBe("export const Card = () => null\n")
    expect(r.changed).toEqual(["components/Card.tsx"])
  })

  it("applies a matching edit hunk", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/home.tsx", op: "edit", hunks: [{ search: "return null", replace: "return <View />" }] }] }))
    expect(r.diagnostics).toEqual([])
    expect(r.ws?.files["app/home.tsx"]).toContain("return <View />")
  })

  it("deletes a file", () => {
    const withExtra = { files: { ...base.files, "components/Old.tsx": "export const Old = () => null\n" } }
    const r = applyChangeSet(withExtra, cs({ files: [{ path: "components/Old.tsx", op: "delete" }] }))
    expect(r.diagnostics).toEqual([])
    expect(r.ws?.files["components/Old.tsx"]).toBeUndefined()
  })

  it("reports a non-matching hunk without applying it", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/home.tsx", op: "edit", hunks: [{ search: "this text is not in the file", replace: "x" }] }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ gate: "parse", code: "edit_no_match" })
  })

  it("refuses to edit a platform-owned path", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "theme/index.tsx", op: "write", content: "x" }] }))
    expect(r.ws).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ gate: "policy", code: "platform_owned" })
  })

  it("refuses to edit a compiler-owned path", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/_layout.tsx", op: "write", content: "x" }] }))
    expect(r.diagnostics[0]).toMatchObject({ gate: "policy", code: "compiler_owned" })
  })

  it("refuses a path outside the writable areas", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "scripts/evil.mjs", op: "write", content: "x" }] }))
    expect(r.diagnostics[0]).toMatchObject({ gate: "policy", code: "path_not_allowed" })
  })

  it("rejects a path with a directory traversal", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/../../../etc/passwd", op: "write", content: "x" }] }))
    expect(r.diagnostics[0].code).toBe("path_not_allowed")
  })

  it("reports editing a file that doesn't exist yet", () => {
    const r = applyChangeSet(base, cs({ files: [{ path: "app/missing.tsx", op: "edit", hunks: [{ search: "x", replace: "y" }] }] }))
    expect(r.diagnostics[0]).toMatchObject({ gate: "parse", code: "edit_missing_file" })
  })
})

describe("workspaceFromDoc / docFromWorkspace", () => {
  const doc: AppDoc = {
    v: 2,
    backend: { provider: "local" },
    screens: [{ id: "home", name: "Home", state: "ready", path: "app/home.tsx", code: "old code\n" }],
    files: { "components/Card.tsx": "export const Card = () => null\n" },
  }

  it("puts screen code and other files into one FileMap", () => {
    const ws = workspaceFromDoc(doc)
    expect(ws.files["app/home.tsx"]).toBe("old code\n")
    expect(ws.files["components/Card.tsx"]).toBe("export const Card = () => null\n")
  })

  it("writes changed screen code back by path and marks it ready", () => {
    const ws = workspaceFromDoc(doc)
    const next = docFromWorkspace(doc, { files: { ...ws.files, "app/home.tsx": "new code\n" } })
    expect(next.screens[0].code).toBe("new code\n")
    expect(next.screens[0].state).toBe("ready")
  })

  it("writes non-screen files back into doc.files", () => {
    const ws = workspaceFromDoc(doc)
    const next = docFromWorkspace(doc, { files: { ...ws.files, "components/Card.tsx": "export const Card = () => <View />\n" } })
    expect(next.files?.["components/Card.tsx"]).toBe("export const Card = () => <View />\n")
  })
})
