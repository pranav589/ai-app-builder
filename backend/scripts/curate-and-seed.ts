// Downloads curated images, uploads directly to ImageKit, writes to a CSV, and seeds into Postgres image_library.
// Usage: npm run seed:curate [-- --limit 20] [--csv image-library.csv] [--concurrency 3]
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { db, imageLibrary } from "@/db"
import { isImageKitConfigured, uploadToImageKit } from "@/lib/imagekit"

export type CuratedItem = {
  url: string
  category: string
  description: string
  tags: string[]
}

function deterministicId(key: string, category: string): string {
  const hash = crypto.createHash("sha256").update(`${category.toLowerCase()}:${key}`).digest("hex").slice(0, 16)
  return `img_${hash}`
}

function escapeCsvCell(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function curateAndSeed(options: {
  catalogPath?: string
  csvPath?: string
  limit?: number
  concurrency?: number
  category?: string
}) {
  if (!isImageKitConfigured()) {
    throw new Error(
      "ImageKit credentials not configured. Please set IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY in .env."
    )
  }

  const catalogFile = path.resolve(
    process.cwd(),
    options.catalogPath || "scripts/data/curated-authentic.json"
  )
  if (!fs.existsSync(catalogFile)) {
    throw new Error(`Catalog file not found: ${catalogFile}. Run 'npx tsx scripts/build-authentic-catalog.ts' first.`)
  }

  let items: CuratedItem[] = JSON.parse(fs.readFileSync(catalogFile, "utf8"))
  if (options.category) {
    items = items.filter((i) => i.category.toLowerCase() === options.category!.toLowerCase())
  }
  if (options.limit && options.limit > 0) {
    items = items.slice(0, options.limit)
  }

  const csvPath = path.resolve(process.cwd(), options.csvPath || "image-library.csv")
  const csvExists = fs.existsSync(csvPath)

  // Initialize CSV with headers if it doesn't exist
  if (!csvExists) {
    fs.writeFileSync(
      csvPath,
      "id,imagekit_file_id,url,category,description,tags,original_source_url\n",
      "utf8"
    )
  }

  console.log(`\nStarting Curated Seed Pipeline:`)
  console.log(`  Items to process: ${items.length}`)
  console.log(`  CSV Output:       ${csvPath}`)
  console.log(`  Concurrency:      ${options.concurrency || 3}`)

  // Pre-load existing rows from Postgres for idempotency
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
  const failures: Array<{ item: CuratedItem; error: string }> = []
  let uploadedCount = 0
  let skippedCount = 0

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const { item, index } = entry
      const prefix = `[${index + 1}/${items.length}]`
      const id = deterministicId(item.url, item.category)

      // Skip if already in database
      const existing = existingById.get(id)
      if (existing) {
        skippedCount++
        console.log(`${prefix} [SKIPPED] ${item.category}: ${item.description.slice(0, 40)}... (already in DB)`)
        continue
      }

      try {
        // 1. Download image from source URL
        const res = await fetch(item.url, {
          headers: { "User-Agent": "AppForge-Image-Seeder/1.0" },
          signal: AbortSignal.timeout(20_000),
        })

        if (!res.ok) {
          throw new Error(`Failed to download from ${item.url} (status: ${res.status})`)
        }

        const arrayBuffer = await res.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // 2. Upload to ImageKit
        const cleanCategory = item.category.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
        const ext = item.url.includes(".webp") ? "webp" : item.url.includes(".png") ? "png" : "jpg"
        const fileName = `${cleanCategory}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
        const uploadTags = Array.from(new Set([...item.tags, "library", cleanCategory]))

        const ikRes = await uploadToImageKit({
          file: buffer,
          fileName,
          folder: `/appforge/library/${cleanCategory}`,
          tags: uploadTags,
        })

        if (ikRes.fileId.startsWith("sim_")) {
          throw new Error("ImageKit returned a simulated ID. Valid credentials required.")
        }

        // 3. Insert into Postgres
        await db
          .insert(imageLibrary)
          .values({
            id,
            imagekitFileId: ikRes.fileId,
            url: ikRes.url,
            category: item.category,
            description: item.description,
            tags: item.tags,
          })
          .onConflictDoUpdate({
            target: imageLibrary.imagekitFileId,
            set: {
              url: ikRes.url,
              category: item.category,
              description: item.description,
              tags: item.tags,
            },
          })

        existingById.set(id, { id, imagekitFileId: ikRes.fileId, url: ikRes.url })
        existingByFileId.set(ikRes.fileId, { id, imagekitFileId: ikRes.fileId, url: ikRes.url })

        // 4. Append row to CSV
        const csvLine = [
          escapeCsvCell(id),
          escapeCsvCell(ikRes.fileId),
          escapeCsvCell(ikRes.url),
          escapeCsvCell(item.category),
          escapeCsvCell(item.description),
          escapeCsvCell(item.tags.join(";")),
          escapeCsvCell(item.url),
        ].join(",") + "\n"

        fs.appendFileSync(csvPath, csvLine, "utf8")

        uploadedCount++
        console.log(`${prefix} [UPLOADED] ${item.category}: ${item.description.slice(0, 40)}... -> ${ikRes.url}`)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.warn(`${prefix} [FAILED] ${item.description.slice(0, 40)}: ${errorMsg}`)
        failures.push({ item, error: errorMsg })
      }
    }
  })

  await Promise.all(workers)

  console.log("\n========================================")
  console.log("Curated Seeding Complete:")
  console.log(`  Total items:     ${items.length}`)
  console.log(`  Uploaded & DB:   ${uploadedCount}`)
  console.log(`  Skipped (exist): ${skippedCount}`)
  console.log(`  Failures:        ${failures.length}`)
  console.log(`  CSV saved to:    ${csvPath}`)
  console.log("========================================")

  if (failures.length > 0) {
    console.log("\nFailures:")
    failures.forEach((f) => console.log(`  - ${f.item.description}: ${f.error}`))
  }

  return { uploadedCount, skippedCount, failures }
}

async function main() {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }

  const limit = arg("--limit") ? parseInt(arg("--limit")!, 10) : undefined
  const concurrency = arg("--concurrency") ? parseInt(arg("--concurrency")!, 10) : 3
  const csvPath = arg("--csv")
  const category = arg("--category")
  const catalogPath = arg("--catalog")

  await curateAndSeed({
    catalogPath,
    csvPath,
    limit,
    concurrency,
    category,
  })
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/curate-and-seed.ts")) {
  main().catch((e) => {
    console.error("Pipeline failed:", e)
    process.exit(1)
  })
}
