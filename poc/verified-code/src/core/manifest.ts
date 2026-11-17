import { z } from "zod"

import type { Diagnostic, JsonPatchOp } from "./types"

// The app's declared structure. The compiler turns it into the files that
// hold the app together (navigation, typed routes, data hooks, theme).

const ident = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "must be camelCase, starting with a lowercase letter")
const entityName = z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "must be PascalCase")

/** "string" | "int" | "number" | "bool" | "date" | "ref:Entity", optionally suffixed with "?" */
export const fieldType = z.string().regex(/^(string|int|number|bool|date|ref:[A-Z][A-Za-z0-9]*)\??$/, "unknown field type")

/** Screen params: "string" | "number" | "ref:Entity" (an id of that entity). */
export const paramType = z.string().regex(/^(string|number|ref:[A-Z][A-Za-z0-9]*)$/, "unknown param type")

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    app: z.object({ name: z.string().min(1).max(40), slug: z.string().regex(/^[a-z0-9-]+$/) }).strict(),
    theme: z
      .object({
        mode: z.enum(["light", "dark"]),
        colors: z
          .object({
            primary: hex,
            onPrimary: hex,
            background: hex,
            surface: hex,
            text: hex,
            textMuted: hex,
            border: hex,
            success: hex,
            danger: hex,
          })
          .strict(),
        radius: z.enum(["sharp", "soft", "round"]),
      })
      .strict(),
    navigation: z
      .object({
        tabs: z.array(ident).max(5),
        initial: ident,
      })
      .strict(),
    screens: z.record(
      ident,
      z
        .object({
          title: z.string().min(1).max(40),
          presentation: z.enum(["tab", "stack", "modal"]),
          params: z.record(ident, paramType).optional(),
        })
        .strict()
    ),
    entities: z.record(
      entityName,
      z
        .object({
          fields: z.record(ident, fieldType),
          seed: z.array(z.record(z.unknown())).max(50).default([]),
        })
        .strict()
    ),
  })
  .strict()

export type AppManifest = z.infer<typeof manifestSchema>

const issue = (path: string, code: string, message: string): Diagnostic => ({ gate: "manifest", code, message, file: "manifest.json", related: [{ file: "manifest.json", line: 0, text: path }] })

/** Schema plus reference checks. Pure: runs the same on server and browser. */
export function validateManifest(raw: unknown): { manifest?: AppManifest; diagnostics: Diagnostic[] } {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      diagnostics: parsed.error.issues.map((i) => issue("/" + i.path.join("/"), "schema", `${"/" + i.path.join("/")}: ${i.message}`)),
    }
  }
  const m = parsed.data
  const out: Diagnostic[] = []
  const screens = Object.keys(m.screens)
  const entities = Object.keys(m.entities)

  for (const tab of m.navigation.tabs) {
    if (!m.screens[tab]) out.push(issue(`/navigation/tabs`, "unknown_screen", `Tab "${tab}" is not a screen. Screens: ${screens.join(", ")}.`))
    else if (m.screens[tab].presentation !== "tab") out.push(issue(`/screens/${tab}/presentation`, "tab_presentation", `Screen "${tab}" is in navigation.tabs, so its presentation must be "tab".`))
  }
  for (const [id, s] of Object.entries(m.screens)) {
    if (s.presentation === "tab" && !m.navigation.tabs.includes(id))
      out.push(issue(`/navigation/tabs`, "tab_missing", `Screen "${id}" has presentation "tab" but is not listed in navigation.tabs.`))
    if (s.presentation === "tab" && s.params && Object.keys(s.params).length)
      out.push(issue(`/screens/${id}/params`, "tab_params", `Tab screen "${id}" cannot take params.`))
    for (const [p, t] of Object.entries(s.params ?? {})) {
      const ref = /^ref:(.+)$/.exec(t)?.[1]
      if (ref && !m.entities[ref]) out.push(issue(`/screens/${id}/params/${p}`, "unknown_entity", `Param "${p}" refers to entity "${ref}", which does not exist. Entities: ${entities.join(", ")}.`))
    }
  }
  if (!m.screens[m.navigation.initial]) out.push(issue(`/navigation/initial`, "unknown_screen", `Initial screen "${m.navigation.initial}" does not exist.`))
  else if (Object.keys(m.screens[m.navigation.initial].params ?? {}).length)
    out.push(issue(`/navigation/initial`, "initial_params", `The initial screen cannot take params.`))
  if (m.navigation.tabs.length === 1) out.push(issue(`/navigation/tabs`, "tab_count", `Use 0 or 2-5 tabs, not 1.`))

  for (const [name, e] of Object.entries(m.entities)) {
    for (const [f, t] of Object.entries(e.fields)) {
      if (f === "id" || f === "createdAt") out.push(issue(`/entities/${name}/fields/${f}`, "reserved_field", `"${f}" is added automatically; remove it.`))
      const ref = /^ref:([A-Za-z0-9]+)/.exec(t)?.[1]
      if (ref && !m.entities[ref]) out.push(issue(`/entities/${name}/fields/${f}`, "unknown_entity", `Field "${name}.${f}" refers to entity "${ref}", which does not exist.`))
    }
    e.seed.forEach((row, i) => {
      for (const k of Object.keys(row)) {
        if (k !== "id" && !e.fields[k]) out.push(issue(`/entities/${name}/seed/${i}/${k}`, "unknown_field", `Seed row ${i} of ${name} has field "${k}", which ${name} does not declare.`))
      }
    })
  }
  return { manifest: out.length ? undefined : m, diagnostics: out }
}

// ---------------------------------------------------------------- JSON Patch (RFC 6902 subset)

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~")

export function applyPatch<T>(doc: T, ops: JsonPatchOp[]): { doc?: T; error?: string } {
  const root = structuredClone(doc) as unknown
  for (const op of ops) {
    if (!op.path.startsWith("/")) return { error: `Patch path "${op.path}" must start with "/".` }
    const parts = op.path.slice(1).split("/").map(unescape)
    const last = parts.pop()!
    let parent: any = root
    for (const p of parts) {
      if (parent == null || typeof parent !== "object" || !(p in parent)) return { error: `Patch path "${op.path}" does not exist (missing "${p}").` }
      parent = parent[p]
    }
    if (parent == null || typeof parent !== "object") return { error: `Patch path "${op.path}" has no container.` }
    if (Array.isArray(parent)) {
      const i = last === "-" ? parent.length : Number(last)
      if (!Number.isInteger(i) || i < 0 || i > parent.length) return { error: `Patch index "${last}" is out of range at "${op.path}".` }
      if (op.op === "add") parent.splice(i, 0, op.value)
      else if (op.op === "replace") {
        if (i >= parent.length) return { error: `Nothing to replace at "${op.path}".` }
        parent[i] = op.value
      } else {
        if (i >= parent.length) return { error: `Nothing to remove at "${op.path}".` }
        parent.splice(i, 1)
      }
    } else {
      if (op.op === "remove" || op.op === "replace") {
        if (!(last in parent)) return { error: `Nothing to ${op.op} at "${op.path}".` }
      }
      if (op.op === "remove") delete parent[last]
      else parent[last] = op.value
    }
  }
  return { doc: root as T }
}
