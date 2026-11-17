// The app's data contract: the collections every screen reads and writes,
// with seed records so a fresh preview already looks lived-in. Screens bind
// to these names declaratively; the backend (local storage today, CloudHike
// later) stores them. Shared by the server and the browser.

export type FieldType = "string" | "text" | "number" | "boolean" | "date" | "image" | "enum"

export type DataField = {
  name: string
  type: FieldType
  label?: string
  options?: string[]
}

export type DataCollection = {
  /** camelCase or kebab identifier used in data-list="..." etc. */
  name: string
  label: string
  fields: DataField[]
  seed: Record<string, unknown>[]
}

export type DataModel = {
  collections: DataCollection[]
  /** Initial values for data-setting="..." toggles and inputs. */
  settings: Record<string, unknown>
  /** The signed-in person shown on profile screens before real auth exists. */
  user: { name: string; email: string; avatar?: string }
  /** Hash of the plan parts the model was made from. A change reseeds local data. */
  hash: string
}

const FIELD_TYPES: FieldType[] = ["string", "text", "number", "boolean", "date", "image", "enum"]
const ident = (s: unknown) =>
  typeof s === "string"
    ? s
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^[^A-Za-z]+/, "")
        .slice(0, 40)
    : ""

let counter = 0
export const newRecordId = () => `r${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function emptyDataModel(hash = ""): DataModel {
  return { collections: [], settings: {}, user: { name: "Alex Morgan", email: "alex@example.com" }, hash }
}

/** Validates the AI's data model, dropping anything malformed. */
export function normalizeDataModel(raw: unknown, hash: string): DataModel {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const collections: DataCollection[] = []
  const seen = new Set<string>()
  for (const c of Array.isArray(m.collections) ? m.collections.slice(0, 12) : []) {
    if (!c || typeof c !== "object") continue
    const col = c as Record<string, unknown>
    const name = ident(col.name)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const fields: DataField[] = (Array.isArray(col.fields) ? col.fields : [])
      .map((f): DataField | null => {
        const ff = (f ?? {}) as Record<string, unknown>
        const fname = ident(ff.name)
        if (!fname || fname === "id") return null
        const type = FIELD_TYPES.includes(ff.type as FieldType) ? (ff.type as FieldType) : "string"
        return {
          name: fname,
          type,
          label: typeof ff.label === "string" ? ff.label.slice(0, 40) : undefined,
          options: Array.isArray(ff.options) ? ff.options.filter((o): o is string => typeof o === "string").slice(0, 12) : undefined,
        }
      })
      .filter((f): f is DataField => !!f)
      .slice(0, 16)
    const seed = (Array.isArray(col.seed) ? col.seed : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
      .slice(0, 20)
      .map((r, i) => ({ ...r, id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `${name}-${i + 1}` }))
    collections.push({ name, label: typeof col.label === "string" ? col.label.slice(0, 40) : name, fields, seed })
  }
  const settings = m.settings && typeof m.settings === "object" && !Array.isArray(m.settings) ? (m.settings as Record<string, unknown>) : {}
  const u = (m.user && typeof m.user === "object" ? m.user : {}) as Record<string, unknown>
  const fallback = emptyDataModel(hash).user
  return {
    collections,
    settings,
    user: {
      name: typeof u.name === "string" && u.name.trim() ? u.name.trim().slice(0, 60) : fallback.name,
      email: typeof u.email === "string" && u.email.includes("@") ? u.email.slice(0, 80) : fallback.email,
    },
    hash,
  }
}

const FIELD_TS_TYPE: Record<FieldType, string> = {
  string: "string",
  text: "string",
  number: "number",
  boolean: "boolean",
  date: "string",
  image: "string",
  enum: "string",
}

const pascalCase = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") || "Record"

/** "habits" -> "habit", "categories" -> "category" (rough English singularization, good enough for collection names). */
const singular = (s: string) =>
  s
    .replace(/(ies)$/i, "y")
    .replace(/(ses|xes|ches|shes)$/i, (m) => m.slice(0, -2))
    .replace(/s$/i, "")

/** The TypeScript type name a collection's records are given in the generated @/data/types module. */
export const collectionTypeName = (collectionName: string) => pascalCase(singular(collectionName))

const fieldTsType = (f: DataField) => (f.type === "enum" && f.options?.length ? f.options.map((o) => JSON.stringify(o)).join(" | ") : FIELD_TS_TYPE[f.type])

/**
 * `data/types.ts`: one record type per collection, plus a `Collections` map
 * the typed `useCollection`/`useRecord` overloads key off of. Generated
 * deterministically so the same data model always produces the same file;
 * regenerated whenever the model changes (same cadence as data/seed.json).
 */
export function generateDataTypes(m: DataModel): string {
  if (!m.collections.length) {
    return `// Generated from the app's data model (lib/app-runtime/data-model.ts). Do not edit: it is
// rewritten whenever the data model changes.

/** No data collections yet. */
export type Collections = Record<string, never>
`
  }
  const types = m.collections
    .map((c) => {
      const name = collectionTypeName(c.name)
      const fields = c.fields.map((f) => `  ${f.name}: ${fieldTsType(f)}`).join("\n")
      return `export type ${name} = {\n  id: string\n${fields}\n  createdAt: string\n  updatedAt?: string\n}`
    })
    .join("\n\n")
  const map = m.collections.map((c) => `  ${JSON.stringify(c.name)}: ${collectionTypeName(c.name)}`).join("\n")
  return `// Generated from the app's data model (lib/app-runtime/data-model.ts). Do not edit: it is
// rewritten whenever the data model changes.

${types}

/** Maps a collection name to its record type, for useCollection/useRecord. */
export type Collections = {
${map}
}
`
}

/** A compact description of the model for the screen designer prompt. */
export function describeDataModel(m: DataModel) {
  if (!m.collections.length) return "No data collections (this app shows static content only)."
  return m.collections
    .map((c) => {
      const fields = c.fields.map((f) => `${f.name}:${f.type}${f.options?.length ? `(${f.options.join("|")})` : ""}`).join(", ")
      const sample = c.seed[0] ? JSON.stringify(c.seed[0]).slice(0, 260) : "{}"
      return `- "${c.name}" (${c.label}, ${c.seed.length} seed records). Fields: id, ${fields}, createdAt. Example: ${sample}`
    })
    .join("\n")
}
