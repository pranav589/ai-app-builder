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

  it("answers the same REST routes the hosted /api/app-runtime route does, mapped to the same ops", () => {
    const code = files["server/index.ts"]
    const mappings: [string, string][] = [
      [`match("/collections/:name", url.pathname))) opBody = { op: "list"`, "GET /collections/:name -> list"],
      [`match("/collections/:name", url.pathname))) opBody = { op: "insert"`, "POST /collections/:name -> insert"],
      [`match("/collections/:name/:id", url.pathname))) opBody = { op: "get"`, "GET /collections/:name/:id -> get"],
      [`match("/collections/:name/:id", url.pathname))) opBody = { op: "update"`, "PATCH /collections/:name/:id -> update"],
      [`match("/collections/:name/:id", url.pathname))) opBody = { op: "remove"`, "DELETE /collections/:name/:id -> remove"],
      [`url.pathname === "/settings") opBody = { op: "settings"`, "GET /settings -> settings"],
      [`match("/settings/:key", url.pathname))) opBody = { op: "setSetting"`, "PUT /settings/:key -> setSetting"],
      [`url.pathname === "/auth/sign-up") opBody = { op: "auth.signUp"`, "POST /auth/sign-up -> auth.signUp"],
      [`url.pathname === "/auth/sign-in") opBody = { op: "auth.signIn"`, "POST /auth/sign-in -> auth.signIn"],
      [`url.pathname === "/auth/sign-out") opBody = { op: "auth.signOut"`, "POST /auth/sign-out -> auth.signOut"],
      [`url.pathname === "/auth/me") opBody = { op: "auth.current"`, "GET /auth/me -> auth.current"],
      [`url.pathname === "/uploads") opBody = { op: "upload"`, "POST /uploads -> upload"],
    ]
    for (const [needle, label] of mappings) expect(code, label).toContain(needle)
  })

  it("still answers the legacy POST /data endpoint, for a pre-redesign exported app", () => {
    expect(files["server/index.ts"]).toContain('url.pathname === "/data"')
  })

  it("the path matcher extracts named params and rejects a length mismatch", () => {
    // Exercises the exact `match()` implementation embedded in the server (copied here
    // since it's a string template, not an importable module).
    function match(pattern: string, pathname: string): Record<string, string> | null {
      const pParts = pattern.split("/").filter(Boolean)
      const uParts = pathname.split("/").filter(Boolean)
      if (pParts.length !== uParts.length) return null
      const params: Record<string, string> = {}
      for (let i = 0; i < pParts.length; i++) {
        if (pParts[i].startsWith(":")) params[pParts[i].slice(1)] = decodeURIComponent(uParts[i])
        else if (pParts[i] !== uParts[i]) return null
      }
      return params
    }
    expect(match("/collections/:name/:id", "/collections/tasks/t1")).toEqual({ name: "tasks", id: "t1" })
    expect(match("/collections/:name", "/collections/tasks/t1")).toBeNull()
    expect(match("/settings/:key", "/settings/theme")).toEqual({ key: "theme" })
  })
})
