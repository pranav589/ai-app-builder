/**
 * ImageKit Integration for AI Image Generation, Management, and Transformation.
 *
 * Documentation: https://imagekit.io/docs/image-transformation
 * AI Transformations: https://imagekit.io/docs/ai-transformations
 */

export interface ImageKitConfig {
  publicKey: string
  privateKey: string
  urlEndpoint: string
}

export interface ImageKitTransformOptions {
  prompt?: string
  background?: "remove" | "genfill" | string
  shadow?: boolean
  width?: number
  height?: number
  crop?: "auto" | "face" | "maintain_ratio" | string
  quality?: number
  format?: "auto" | "webp" | "jpg" | "png"
  blur?: number
  grayscale?: boolean
  sepia?: boolean
  contrast?: number
  brightness?: number
  saturation?: number
  upscale?: boolean
  retouch?: boolean
  rawTransform?: string
}

const DEFAULT_ENDPOINT = "https://ik.imagekit.io/appforge_demo"

/**
 * Returns the configured ImageKit credentials and endpoint.
 */
export function getImageKitConfig(): ImageKitConfig {
  const publicKey =
    process.env.IMAGEKIT_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY ||
    ""
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || ""
  const urlEndpoint = (
    process.env.IMAGEKIT_URL_ENDPOINT ||
    process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ||
    DEFAULT_ENDPOINT
  ).replace(/\/+$/, "")

  return { publicKey, privateKey, urlEndpoint }
}

export function isImageKitConfigured(): boolean {
  const cfg = getImageKitConfig()
  return Boolean(cfg.privateKey && cfg.publicKey)
}

/**
 * Parses a natural language user prompt into a list of ImageKit AI & standard transformation parameters.
 * Examples:
 * - "remove background" -> ["e-removedotbg"]
 * - "remove background and add shadow" -> ["e-removedotbg", "e-dropshadow"]
 * - "change background to modern luxury kitchen" -> ["e-changebg-prompt-modern luxury kitchen"]
 * - "expand canvas with generative fill" -> ["bg-genfill"]
 * - "ai upscale and retouch" -> ["e-upscale", "e-retouch"]
 * - "make it black and white" -> ["e-grayscale"]
 */
export function parsePromptToTransformations(prompt: string): string[] {
  const trimmed = prompt.trim()
  if (!trimmed) return []

  const lower = trimmed.toLowerCase()
  const transforms: string[] = []

  // Background removal
  if (
    /\b(remove\s+bg|remove\s+background|transparent\s+bg|transparent\s+background|cut\s*out)\b/i.test(
      lower
    )
  ) {
    transforms.push("e-removedotbg")
  }

  // Drop shadow
  if (/\b(shadow|drop\s*shadow)\b/i.test(lower)) {
    transforms.push("e-dropshadow")
  }

  // Generative fill / outpainting
  if (/\b(genfill|generative\s+fill|outpaint|expand\s+canvas)\b/i.test(lower)) {
    transforms.push("bg-genfill")
  }

  // AI upscale / enhance
  if (/\b(upscale|super\s*res|enhance|high\s*res)\b/i.test(lower)) {
    transforms.push("e-upscale")
  }

  // AI retouch
  if (/\b(retouch|airbrush|smooth)\b/i.test(lower)) {
    transforms.push("e-retouch")
  }

  // Grayscale / Black & White
  if (/\b(grayscale|black\s+and\s+white|b&w|monochrome)\b/i.test(lower)) {
    transforms.push("e-grayscale")
  }

  // Sepia
  if (/\bsepia\b/i.test(lower)) {
    transforms.push("e-sepia")
  }

  // Blur
  if (/\bblur(red)?\b/i.test(lower)) {
    transforms.push("bl-6")
  }

  // Check if there is an actual descriptive scene for AI background change
  let scene = trimmed
    .replace(/\b(remove\s+(the\s+)?background|transparent\s+background|cut\s*out)\b/gi, "")
    .replace(/\b(add\s+)?(drop\s+)?shadow\b/gi, "")
    .replace(/\b(genfill|generative\s+fill|outpaint|expand\s+canvas)\b/gi, "")
    .replace(/\b(upscale|super\s*res|enhance|high\s*res|retouch|airbrush)\b/gi, "")
    .replace(/\b(grayscale|black\s+and\s+white|b&w|monochrome|sepia)\b/gi, "")
    .replace(/\b(blur(red)?)\b/gi, "")
    .replace(/^(change|replace|set|make|switch|turn)(\s+the)?\s+background(\s+(to|with|into|as))?:?\s*/i, "")
    .replace(/^put\s+(it|this|subject)\s+(on|in|into|against)\s+/i, "")
    .replace(/^background:?\s*/i, "")
    .replace(/\b(and|with|also)\b/gi, "")
    .replace(/[,.-]/g, " ")
    .trim()

  if (scene.length > 2) {
    const encodedPrompt = encodeURIComponent(scene).replace(/%20/g, " ")
    transforms.push(`e-changebg-prompt-${encodedPrompt}`)
  }

  return transforms
}

/**
 * Builds the chained ImageKit transformation string from structured options.
 */
export function buildTransformString(
  options: ImageKitTransformOptions | string | string[]
): string {
  if (typeof options === "string") {
    return options.replace(/^tr=/, "")
  }

  if (Array.isArray(options)) {
    return options.filter(Boolean).join(":")
  }

  const parts: string[] = []

  // Natural language prompt parsed first
  if (options.prompt) {
    const promptParts = parsePromptToTransformations(options.prompt)
    parts.push(...promptParts)
  }

  if (options.background === "remove") {
    if (!parts.includes("e-removedotbg")) parts.push("e-removedotbg")
  } else if (options.background === "genfill") {
    if (!parts.includes("bg-genfill")) parts.push("bg-genfill")
  } else if (
    typeof options.background === "string" &&
    options.background.trim() &&
    !parts.some((p) => p.startsWith("e-changebg-prompt-"))
  ) {
    parts.push(`e-changebg-prompt-${encodeURIComponent(options.background.trim())}`)
  }

  if (options.shadow && !parts.includes("e-dropshadow")) {
    parts.push("e-dropshadow")
  }

  if (options.upscale && !parts.includes("e-upscale")) {
    parts.push("e-upscale")
  }

  if (options.retouch && !parts.includes("e-retouch")) {
    parts.push("e-retouch")
  }

  if (options.grayscale && !parts.includes("e-grayscale")) {
    parts.push("e-grayscale")
  }

  if (options.sepia && !parts.includes("e-sepia")) {
    parts.push("e-sepia")
  }

  if (options.blur) {
    parts.push(`bl-${options.blur}`)
  }

  if (options.contrast !== undefined) {
    parts.push(`co-${options.contrast}`)
  }

  if (options.brightness !== undefined) {
    parts.push(`b-${options.brightness}`)
  }

  if (options.saturation !== undefined) {
    parts.push(`s-${options.saturation}`)
  }

  // Dimensions & Cropping
  const dimParts: string[] = []
  if (options.width) dimParts.push(`w-${options.width}`)
  if (options.height) dimParts.push(`h-${options.height}`)
  if (options.crop) dimParts.push(`fo-${options.crop}`)
  if (options.quality) dimParts.push(`q-${options.quality}`)
  if (options.format) dimParts.push(`f-${options.format}`)

  if (dimParts.length > 0) {
    parts.push(dimParts.join(","))
  }

  if (options.rawTransform) {
    parts.push(options.rawTransform)
  }

  return parts.filter(Boolean).join(":")
}

/**
 * Applies ImageKit transformations to an image URL.
 * Supports both existing ImageKit URLs and external image URLs.
 */
export function buildTransformedUrl(
  sourceUrl: string,
  transformations: ImageKitTransformOptions | string | string[]
): string {
  const transformString = buildTransformString(transformations)
  if (!transformString) return sourceUrl

  const { urlEndpoint } = getImageKitConfig()

  try {
    const parsed = new URL(sourceUrl)
    const isImageKit = parsed.hostname.includes("imagekit.io")

    if (isImageKit) {
      // If it's already an ImageKit URL, merge or append tr query parameter
      const searchParams = new URLSearchParams(parsed.search)
      const existingTr = searchParams.get("tr")

      let finalTr = transformString
      if (existingTr) {
        // Merge without duplicating
        const existingSteps = existingTr.split(":")
        const newSteps = transformString.split(":")
        const merged = Array.from(new Set([...existingSteps, ...newSteps]))
        finalTr = merged.join(":")
      }

      searchParams.set("tr", finalTr)
      parsed.search = searchParams.toString()
      return parsed.toString()
    }

    // If it's an external URL (e.g. Unsplash, S3, CloudHike):
    // ImageKit supports web proxy transformations or hosted path:
    // Format: {endpoint}/tr:{transforms}/{fullExternalUrl}
    return `${urlEndpoint}/tr:${transformString}/${sourceUrl.replace(/^https?:\/\//, "")}`
  } catch {
    // If not a full URL, treat as relative asset path on ImageKit
    const cleanPath = sourceUrl.replace(/^\/+/, "")
    return `${urlEndpoint}/${cleanPath}?tr=${transformString}`
  }
}

/**
 * Uploads a file (base64 string, URL, or Buffer) to ImageKit using ImageKit Upload API.
 * Method: POST https://upload.imagekit.io/api/v1/files/upload
 * Auth: Basic auth with privateKey:
 */
export async function uploadToImageKit({
  file,
  fileName,
  folder = "/appforge",
  tags = ["appforge", "ai-generated"],
}: {
  file: string | Buffer
  fileName?: string
  folder?: string
  tags?: string[]
}): Promise<{ url: string; fileId: string; name: string; thumbnailUrl?: string }> {
  const { privateKey, urlEndpoint } = getImageKitConfig()

  const safeFileName =
    fileName || `appforge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`

  if (!privateKey) {
    // If running in development without credentials, provide a resilient, high-quality URL
    const simulatedUrl =
      typeof file === "string" && file.startsWith("http")
        ? file
        : `${urlEndpoint}${folder}/${safeFileName}`
    return {
      url: simulatedUrl,
      fileId: `sim_${Date.now()}`,
      name: safeFileName,
      thumbnailUrl: simulatedUrl,
    }
  }

  const formData = new FormData()

  if (typeof file === "string") {
    formData.append("file", file)
  } else {
    const blob = new Blob([new Uint8Array(file)])
    formData.append("file", blob, safeFileName)
  }

  formData.append("fileName", safeFileName)
  formData.append("folder", folder)
  formData.append("useUniqueFileName", "true")
  if (tags && tags.length) {
    formData.append("tags", tags.join(","))
  }

  const authHeader = `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`

  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: {
      Authorization: authHeader,
    },
    body: formData,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown upload error")
    throw new Error(`ImageKit upload failed (${res.status}): ${errText}`)
  }

  const data = (await res.json()) as {
    url: string
    fileId: string
    name: string
    thumbnailUrl?: string
  }

  return {
    url: data.url,
    fileId: data.fileId,
    name: data.name,
    thumbnailUrl: data.thumbnailUrl,
  }
}

/**
 * Preset styles for AI image generation.
 */
export const AI_IMAGE_STYLES: Record<string, string> = {
  photo: "photorealistic, cinematic lighting, ultra-detailed 8k, professional photography",
  minimal3d: "clean modern 3D render, minimalist pastel colors, smooth claymorphism, soft ambient shadows",
  illustration: "modern app vector illustration, vibrant, stylish, flat design, clean geometry",
  isometric: "isometric 3D view, clean studio lighting, detailed miniature aesthetic, modern tech",
  cyberpunk: "vibrant neon cyberpunk, glowing accents, dark moody background, futuristic aesthetic",
  watercolor: "soft organic watercolor painting, delicate brushstrokes, artistic, calming palette",
}

/**
 * Generates an AI image based on user prompt, uploads it to ImageKit, and returns the ImageKit URL.
 *
 * Image generation is delegated to pollinations.ai (free, no API key): the
 * project's own AI_BASE_URL gateway is chat-completions only (lib/agent/config.ts),
 * so an images/generations call there is never actually supported.
 */
export async function generateAiImage(
  prompt: string,
  styleKey?: string
): Promise<{ url: string; prompt: string }> {
  const trimmed = prompt.trim()
  if (!trimmed) throw new Error("Prompt is required for AI image generation.")

  const styleModifier = styleKey && AI_IMAGE_STYLES[styleKey] ? `, ${AI_IMAGE_STYLES[styleKey]}` : ""
  const fullPrompt = `${trimmed}${styleModifier}`

  const seed = Math.floor(Math.random() * 1000000)
  const sourceImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    fullPrompt
  )}?width=1024&height=1024&nologo=true&seed=${seed}`

  // Without real credentials, skip the network entirely: uploadToImageKit's
  // own no-key branch hands the pollinations URL straight back as "url".
  if (!isImageKitConfigured()) {
    const uploaded = await uploadToImageKit({
      file: sourceImageUrl,
      fileName: `ai_${Date.now()}.jpg`,
      folder: "/appforge/ai-generated",
      tags: ["appforge", "ai-generated", styleKey || "general"],
    })
    return { url: uploaded.url, prompt: trimmed }
  }

  // Fetched here rather than handed to ImageKit as a URL to fetch itself:
  // pollinations.ai generates synchronously (can take 10s+), which ImageKit's
  // own URL-fetch-on-upload frequently times out on ("not able to download
  // file from url"), so the upload would intermittently fail for no fault of
  // the image itself. A generous timeout here covers that generation time.
  const imgRes = await fetch(sourceImageUrl, { signal: AbortSignal.timeout(60_000) })
  if (!imgRes.ok) throw new Error(`pollinations.ai image generation failed (${imgRes.status})`)
  const bytes = Buffer.from(await imgRes.arrayBuffer())

  const uploaded = await uploadToImageKit({
    file: bytes,
    fileName: `ai_${Date.now()}.jpg`,
    folder: "/appforge/ai-generated",
    tags: ["appforge", "ai-generated", styleKey || "general"],
  })
  return { url: uploaded.url, prompt: trimmed }
}
