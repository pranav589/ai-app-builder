// The categories actually present in the curated image_library table (see
// db/sql/image-library.sql and scripts/curate-and-seed.ts's source catalog).
// Shared by the client-safe data model (lib/app-runtime/data-model.ts) and
// the server-side matcher (./match.ts), so it has no "server-only"/db import.
export const IMAGE_LIBRARY_CATEGORIES = [
  "avatars",
  "beauty",
  "books",
  "clothing",
  "electronics",
  "fitness",
  "food",
  "home",
  "jewelry",
  "shoes",
  "vehicles",
] as const

export type ImageLibraryCategory = (typeof IMAGE_LIBRARY_CATEGORIES)[number]

export function isImageLibraryCategory(value: unknown): value is ImageLibraryCategory {
  return typeof value === "string" && (IMAGE_LIBRARY_CATEGORIES as readonly string[]).includes(value)
}
