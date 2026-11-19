import { describe, expect, it } from "vitest"
import { collectionTypeName, emptyDataModel, generateDataTypes, normalizeDataModel } from "@/lib/app-runtime/data-model"

describe("collectionTypeName", () => {
  it("singularizes and pascal-cases a plural collection name", () => {
    expect(collectionTypeName("habits")).toBe("Habit")
    expect(collectionTypeName("categories")).toBe("Category")
    expect(collectionTypeName("boxes")).toBe("Box")
  })

  it("handles a multi-word kebab/camel name", () => {
    expect(collectionTypeName("journal-entries")).toBe("JournalEntry")
  })
})

describe("generateDataTypes", () => {
  it("emits a placeholder type when there are no collections", () => {
    const out = generateDataTypes(emptyDataModel())
    expect(out).toContain("export type Collections = Record<string, never>")
  })

  it("emits one record type per collection with id/createdAt/updatedAt plus its fields", () => {
    const model = {
      ...emptyDataModel(),
      collections: [
        {
          name: "habits",
          label: "Habits",
          fields: [
            { name: "title", type: "string" as const },
            { name: "streak", type: "number" as const },
            { name: "archived", type: "boolean" as const },
            { name: "frequency", type: "enum" as const, options: ["daily", "weekly"] },
          ],
          seed: [],
        },
      ],
    }
    const out = generateDataTypes(model)
    expect(out).toContain("export type Habit = {")
    expect(out).toContain("id: string")
    expect(out).toContain("title: string")
    expect(out).toContain("streak: number")
    expect(out).toContain("archived: boolean")
    expect(out).toContain(`frequency: "daily" | "weekly"`)
    expect(out).toContain("createdAt: string")
    expect(out).toContain("updatedAt?: string")
    expect(out).toContain(`"habits": Habit`)
  })

  it("maps every collection into the Collections lookup", () => {
    const model = {
      ...emptyDataModel(),
      collections: [
        { name: "habits", label: "Habits", fields: [], seed: [] },
        { name: "milestones", label: "Milestones", fields: [], seed: [] },
      ],
    }
    const out = generateDataTypes(model)
    expect(out).toContain(`"habits": Habit`)
    expect(out).toContain(`"milestones": Milestone`)
  })
})

describe("normalizeDataModel category field", () => {
  it("keeps a valid IMAGE_LIBRARY_CATEGORIES value", () => {
    const out = normalizeDataModel(
      { collections: [{ name: "products", label: "Products", category: "shoes", fields: [], seed: [] }] },
      "h"
    )
    expect(out.collections[0].category).toBe("shoes")
  })

  it("drops an invalid category value", () => {
    const out = normalizeDataModel(
      { collections: [{ name: "products", label: "Products", category: "sneakers", fields: [], seed: [] }] },
      "h"
    )
    expect(out.collections[0].category).toBeUndefined()
  })

  it("omits category entirely when absent", () => {
    const out = normalizeDataModel({ collections: [{ name: "tags", label: "Tags", fields: [], seed: [] }] }, "h")
    expect(out.collections[0].category).toBeUndefined()
  })
})
