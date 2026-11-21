import ts from "typescript"
import { describe, expect, it } from "vitest"
import { selfHostFiles } from "../self-host"

describe("selfHostFiles", () => {
  const files = selfHostFiles()
  const sources = Object.entries(files).filter(([p]) => p.endsWith(".ts"))

  it("copies the builder's own data logic instead of rewriting it", () => {
    expect(files["server/app-data.ts"]).toContain("export function dataApi")
    expect(files["server/app-ops.ts"]).toContain("export async function runAppOp")
    expect(files["server/contract.ts"]).toContain("export interface AppServices")
    expect(files["server/data-model-types.ts"]).toContain("export type DataModel")
  })

  it("leaves no import that only resolves inside the builder", () => {
    for (const [path, text] of sources) {
      expect(text, path).not.toMatch(/from "@\//)
      expect(text, path).not.toContain("server-only")
    }
  })

  it("every relative import points at a file in the export", () => {
    for (const [path, text] of sources) {
      for (const [, spec] of text.matchAll(/from "(\.\/[^"]+)"/g)) {
        expect(files[`server/${spec.slice(2)}.ts`], `${path} imports ${spec}`).toBeDefined()
      }
    }
  })

  it("is syntactically valid TypeScript", () => {
    for (const [path, text] of sources) {
      const out = ts.transpileModule(text, { reportDiagnostics: true, fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS } })
      expect(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), path).toEqual([])
    }
  })

  it("declares every package the copied code imports", () => {
    const deps = Object.keys(JSON.parse(files["server/package.json"]).dependencies)
    const imported = new Set<string>()
    for (const [, text] of sources) for (const [, spec] of text.matchAll(/from "([^./][^"]*)"/g)) if (!spec.startsWith("node:")) imported.add(spec)
    for (const spec of imported) expect(deps, spec).toContain(spec)
  })

  it("the .env templates list every variable the server reads", () => {
    const read = [...files["server/index.ts"].matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)].map((m) => m[1]).filter((k) => /^(DATABASE|DIRECT|AUTH|S3)_/.test(k))
    for (const key of read) expect(files["server/.env.example"], key).toContain(`${key}=`)
    expect(files["server/.env.example"]).toContain("APP_KEY=")
  })
})
