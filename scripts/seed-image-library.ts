// Bulk imports curated seed images into ImageKit and Postgres image_library.
// Usage: npm run seed:images -- <manifest.json> [--images-dir <dir>]
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { db, imageLibrary } from "@/db"
import { isImageKitConfigured, uploadToImageKit } from "@/lib/imagekit"

export type ManifestItem = {
  file: string
  category: string
  description?: string
  tags?: string[]
  imagekit_file_id?: string
}

export function parseManifest(raw: unknown): ManifestItem[] {
  let data = raw
  if (typeof data === "string") {
    try {
      data = JSON.parse(data)
    } catch (e) {
      throw new Error(`Invalid manifest JSON: ${e instanceof Error ? e.message : e}`)
    }
  }

  const list = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && "images" in data && Array.isArray((data as { images: unknown }).images)
      ? (data as { images: unknown[] }).images
      : null

  if (!list) {
    throw new Error("Manifest must be a JSON array of image entries (or an object with an 'images' array)")
  }

  return list.map((item: unknown, idx: number) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Manifest item at index ${idx} is not an object`)
    }
    const record = item as Record<string, unknown>
    if (typeof record.file !== "string" || !record.file.trim()) {
      throw new Error(`Manifest item at index ${idx} is missing a valid 'file' string`)
    }
    if (typeof record.category !== "string" || !record.category.trim()) {
      throw new Error(`Manifest item at index ${idx} is missing a valid 'category' string`)
    }

    let tags: string[] = []
    if (Array.isArray(record.tags)) {
      tags = record.tags.map((t) => String(t).trim()).filter(Boolean)
    } else if (typeof record.tags === "string") {
      tags = record.tags.split(",").map((t) => t.trim()).filter(Boolean)
    }

    return {
      file: record.file.trim(),
      category: record.category.trim(),
      description: typeof record.description === "string" ? record.description.trim() : "",
      tags,
      imagekit_file_id: typeof record.imagekit_file_id === "string" ? record.imagekit_file_id.trim() : undefined,
    }
  })
}

export function deterministicImageId(file: string, category: string): string {
  const hash = crypto.createHash("sha256").update(`${category.toLowerCase()}:${file}`).digest("hex").slice(0, 16)
  return `img_${hash}`
}

export async function seedImageLibrary(options: {
  manifestPath: string
  imagesDir?: string
  concurrency?: number
}) {
  if (!isImageKitConfigured()) {
    throw new Error(
      "ImageKit credentials not configured. Real IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY are required to upload library images."
    )
  }

  const resolvedManifest = path.resolve(process.cwd(), options.manifestPath)
  if (!fs.existsSync(resolvedManifest)) {
    throw new Error(`Manifest file not found: ${resolvedManifest}`)
  }

  const manifestContent = fs.readFileSync(resolvedManifest, "utf8")
  const items = parseManifest(manifestContent)
  const imagesBaseDir = options.imagesDir
    ? path.resolve(process.cwd(), options.imagesDir)
    : path.dirname(resolvedManifest)

  console.log(`Loaded ${items.length} items from ${path.basename(resolvedManifest)}`)
  console.log(`Searching for images in: ${imagesBaseDir}`)

  // Pre-load existing rows for idempotency
  const existingRows = await db
    .select({
      id: imageLibrary.id,
      imagekitFileId: imageLibrary.imagekitFileId,
      url: imageLibrary.url,
    })
    .from(imageLibrary)

  const existingById = new Map(existingRows.map((r) => [r.id, r]))
  const existingByFileId = new Map(existingRows.map((r) => [r.imagekitFileId, r]))

  const concurrency = options.concurrency || 3
  const queue = items.map((item, index) => ({ item, index }))
  const failures: Array<{ file: string; error: string }> = []
  let importedCount = 0
  let skippedCount = 0

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const { item, index } = entry
      const progressPrefix = `[${index + 1}/${items.length}]`
      const id = deterministicImageId(item.file, item.category)
      const existing = existingById.get(id) || (item.imagekit_file_id ? existingByFileId.get(item.imagekit_file_id) : undefined)

      try {
        if (existing) {
          // Already uploaded to ImageKit; idempotently update metadata in Postgres
          await db
            .insert(imageLibrary)
            .values({
              id: existing.id,
              imagekitFileId: existing.imagekitFileId,
              url: existing.url,
              category: item.category,
              description: item.description || "",
              tags: item.tags || [],
            })
            .onConflictDoUpdate({
              target: imageLibrary.imagekitFileId,
              set: {
                category: item.category,
                description: item.description || "",
                tags: item.tags || [],
              },
            })
          skippedCount++
          console.log(`${progressPrefix} [SKIPPED] ${item.file} already exists as ${existing.imagekitFileId}`)
          continue
        }

        // Locate local image file
        let candidatePath = path.isAbsolute(item.file) ? item.file : path.resolve(imagesBaseDir, item.file)
        if (!fs.existsSync(candidatePath)) {
          candidatePath = path.resolve(imagesBaseDir, "images", item.file)
        }
        if (!fs.existsSync(candidatePath)) {
          throw new Error(`File does not exist: ${item.file} (checked ${candidatePath})`)
        }

        const buffer = fs.readFileSync(candidatePath)
        const cleanCategory = item.category.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
        const folder = `/appforge/library/${cleanCategory}`
        const uploadTags = Array.from(new Set([...(item.tags || []), "library", cleanCategory]))

        const res = await uploadToImageKit({
          file: buffer,
          fileName: path.basename(candidatePath),
          folder,
          tags: uploadTags,
        })

        if (res.fileId.startsWith("sim_")) {
          throw new Error("ImageKit returned simulated ID; valid credentials required")
        }

        await db
          .insert(imageLibrary)
          .values({
            id,
            imagekitFileId: res.fileId,
            url: res.url,
            category: item.category,
            description: item.description || "",
            tags: item.tags || [],
          })
          .onConflictDoUpdate({
            target: imageLibrary.imagekitFileId,
            set: {
              url: res.url,
              category: item.category,
              description: item.description || "",
              tags: item.tags || [],
            },
          })

        // Track in local map so subsequent duplicates in same batch are caught
        existingById.set(id, { id, imagekitFileId: res.fileId, url: res.url })
        existingByFileId.set(res.fileId, { id, imagekitFileId: res.fileId, url: res.url })
        importedCount++
        console.log(`${progressPrefix} [UPLOADED] ${item.file} -> ${res.url}`)
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        console.warn(`${progressPrefix} [FAILED] ${item.file}: ${errorMsg}`)
        failures.push({ file: item.file, error: errorMsg })
      }
    }
  })

  await Promise.all(workers)

  console.log("\n==============================")
  console.log(`Image Library Import Summary:`)
  console.log(`  Total items:    ${items.length}`)
  console.log(`  Uploaded:       ${importedCount}`)
  console.log(`  Skipped (idempotent): ${skippedCount}`)
  console.log(`  Failures:       ${failures.length}`)
  console.log("==============================")

  if (failures.length > 0) {
    console.log("\nFailure details:")
    failures.forEach((f) => console.log(`  - ${f.file}: ${f.error}`))
  }

  return { items, importedCount, skippedCount, failures }
}

async function main() {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }

  const manifestArg = arg("--manifest") || args.find((a) => !a.startsWith("--"))
  const imagesDir = arg("--images-dir") || arg("--dir")

  if (!manifestArg) {
    console.error("Usage: npm run seed:images -- <manifest.json> [--images-dir <dir>]")
    process.exit(1)
  }

  await seedImageLibrary({
    manifestPath: manifestArg,
    imagesDir,
  })
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/seed-image-library.ts")) {
  main().catch((e) => {
    console.error("Seed script failed:", e)
    process.exit(1)
  })
}
