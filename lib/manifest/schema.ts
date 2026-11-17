// The app's declared structure: screens, navigation, data model and allowed
// packages. A superset of today's AppPlan + DataModel + theme selection.
// The compiler (compile.ts) turns a validated manifest into the files that
// hold the app together; the AI never writes those files, only the manifest
// (via manifest_patch, from Phase 2's gateway) and the screens themselves.
//
// Ported from poc/verified-code/src/core/manifest.ts, adapted to this app's
// real shape: kebab-case screen ids (not camelCase), collections (not
// PascalCase entities) matching lib/app-runtime/data-model.ts's DataModel,
// and an Ionicons name per tab instead of a theme/entity system of its own
// (theme switching and field types already exist here and are reused as-is).

import { z } from "zod"

import { ICONS } from "@/lib/app-project/icons"
import { ALLOWED_PACKAGES } from "@/lib/app-project/project"
import type { Diagnostic, JsonPatchOp } from "@/lib/verify/types"

const SCREEN_ID = /^[a-z][a-z0-9-]*$/
const ICON_NAMES = new Set(ICONS.map((i) => i.ion))

const screenId = z.string().regex(SCREEN_ID, "must be kebab-case, starting with a lowercase letter")
const paramType = z.enum(["string", "number"])
const fieldType = z.enum(["string", "text", "number", "boolean", "date", "image", "enum"])

export const manifestScreenSchema = z
  .object({
    title: z.string().min(1).max(60),
    presentation: z.enum(["tab", "stack", "modal"]),
    params: z.record(z.string(), paramType).optional(),
    /** An Ionicons name (lib/app-project/icons.ts ICONS[].ion), required for tab screens. */
    icon: z.string().optional(),
    /** Which collection this screen is about (its `id` param, if any, is that collection's record id). Render-gate sample data and prompts use this instead of guessing by name. */
    collection: z.string().optional(),
  })
  .strict()

export const manifestFieldSchema = z
  .object({
    type: fieldType,
    label: z.string().max(40).optional(),
    options: z.array(z.string()).max(12).optional(),
  })
  .strict()

export const manifestCollectionSchema = z
  .object({
    label: z.string().min(1).max(40),
    fields: z.record(z.string(), manifestFieldSchema),
    seed: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
  })
  .strict()

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    app: z.object({ name: z.string().min(1).max(60), slug: z.string().regex(/^[a-z0-9-]+$/) }).strict(),
    screens: z.record(screenId, manifestScreenSchema),
    navigation: z
      .object({
        tabs: z.array(screenId).max(5),
        initial: screenId,
      })
      .strict(),
    collections: z.record(z.string(), manifestCollectionSchema).default({}),
    allowedPackages: z.array(z.string()).default([...ALLOWED_PACKAGES]),
  })
  .strict()

export type AppManifest = z.infer<typeof manifestSchema>
export type ManifestScreen = z.infer<typeof manifestScreenSchema>
export type ManifestCollection = z.infer<typeof manifestCollectionSchema>

const issue = (path: string, code: string, message: string): Diagnostic => ({
  gate: "manifest",
  code,
  severity: "error",
  message: `${path}: ${message}`,
})

/** Schema plus reference checks, with fix-friendly messages. Pure: runs the same on server and browser. */
export function validateManifest(raw: unknown): { manifest?: AppManifest; diagnostics: Diagnostic[] } {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    return { diagnostics: parsed.error.issues.map((i) => issue("/" + i.path.join("/"), "schema", i.message)) }
  }
  const m = parsed.data
  const out: Diagnostic[] = []
  const screenIds = Object.keys(m.screens)
  const collectionNames = Object.keys(m.collections)

  for (const tab of m.navigation.tabs) {
    if (!m.screens[tab]) out.push(issue("/navigation/tabs", "unknown_screen", `Tab "${tab}" is not a screen. Screens: ${screenIds.join(", ") || "none"}.`))
    else if (m.screens[tab].presentation !== "tab") out.push(issue(`/screens/${tab}/presentation`, "tab_presentation", `Screen "${tab}" is in navigation.tabs, so its presentation must be "tab".`))
  }
  for (const [id, s] of Object.entries(m.screens)) {
    if (s.presentation === "tab") {
      if (!m.navigation.tabs.includes(id)) out.push(issue("/navigation/tabs", "tab_missing", `Screen "${id}" has presentation "tab" but is not listed in navigation.tabs.`))
      if (s.params && Object.keys(s.params).length) out.push(issue(`/screens/${id}/params`, "tab_params", `Tab screen "${id}" cannot take params.`))
      if (!s.icon) out.push(issue(`/screens/${id}/icon`, "missing_icon", `Tab screen "${id}" needs an icon.`))
    }
    if (s.icon && !ICON_NAMES.has(s.icon)) out.push(issue(`/screens/${id}/icon`, "unknown_icon", `Icon "${s.icon}" isn't in the icon vocabulary. Known icons: ${[...ICON_NAMES].join(", ")}.`))
    if (s.collection && !m.collections[s.collection]) out.push(issue(`/screens/${id}/collection`, "unknown_collection", `Screen "${id}" refers to collection "${s.collection}", which does not exist. Collections: ${collectionNames.join(", ") || "none"}.`))
  }
  if (!m.screens[m.navigation.initial]) out.push(issue("/navigation/initial", "unknown_screen", `Initial screen "${m.navigation.initial}" does not exist.`))
  if (m.navigation.tabs.length === 1) out.push(issue("/navigation/tabs", "tab_count", "Use 0 or 2-5 tabs, not 1."))

  for (const [name, c] of Object.entries(m.collections)) {
    for (const f of Object.keys(c.fields)) {
      if (f === "id" || f === "createdAt" || f === "updatedAt") out.push(issue(`/collections/${name}/fields/${f}`, "reserved_field", `"${f}" is added automatically; remove it from the manifest.`))
    }
    c.seed.forEach((row, i) => {
      for (const k of Object.keys(row)) {
        if (k !== "id" && k !== "createdAt" && !c.fields[k]) out.push(issue(`/collections/${name}/seed/${i}/${k}`, "unknown_field", `Seed row ${i} of "${name}" has field "${k}", which "${name}" does not declare.`))
      }
    })
  }
  return { manifest: out.length ? undefined : m, diagnostics: out }
}

// ---------------------------------------------------------------- JSON Patch (RFC 6902 subset)

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~")

/** Applies a JSON Patch subset (add/replace/remove) to a plain object/array tree. Never mutates `doc`. */
export function applyPatch<T>(doc: T, ops: JsonPatchOp[]): { doc?: T; error?: string } {
  const root = structuredClone(doc) as unknown
  for (const op of ops) {
    if (!op.path.startsWith("/")) return { error: `Patch path "${op.path}" must start with "/".` }
    const parts = op.path.slice(1).split("/").map(unescape)
    const last = parts.pop()
    if (last === undefined) return { error: `Patch path "${op.path}" has no target.` }
    let parent: unknown = root
    for (const p of parts) {
      if (parent == null || typeof parent !== "object" || !(p in parent)) return { error: `Patch path "${op.path}" does not exist (missing "${p}").` }
      parent = (parent as Record<string, unknown>)[p]
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
      const container = parent as Record<string, unknown>
      if ((op.op === "remove" || op.op === "replace") && !(last in container)) return { error: `Nothing to ${op.op} at "${op.path}".` }
      if (op.op === "remove") delete container[last]
      else container[last] = op.value
    }
  }
  return { doc: root as T }
}
