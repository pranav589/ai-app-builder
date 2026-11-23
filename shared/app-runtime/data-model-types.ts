// Types only, with no imports: the exported self-host server copies this file as-is
// (lib/app-project/self-host.ts), so it must not pull in the rest of the data model.

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
  /** Closest match from IMAGE_LIBRARY_CATEGORIES, when this collection has an "image" field; hard-filters its seed image lookup. Omitted when nothing fits. */
  category?: string
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
