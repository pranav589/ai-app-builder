import type { Request, Response, NextFunction } from "express"
import {
  buildTransformedUrl,
  generateAiImage,
  parsePromptToTransformations,
  uploadToImageKit,
  type ImageKitTransformOptions,
} from "../services/imagekit"

export async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const prompt = String(req.body?.prompt || "").trim()
    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" })
      return
    }

    const style = typeof req.body?.style === "string" ? req.body.style : undefined
    const result = await generateAiImage(prompt, style)
    res.json({
      ok: true,
      imageUrl: result.url,
      prompt: result.prompt,
    })
  } catch (err) {
    console.error("ImageKit AI image generation failed:", err)
    res.status(500).json({ error: "Failed to generate AI image" })
  }
}

export async function transform(req: Request, res: Response, next: NextFunction) {
  try {
    const imageUrl = String(req.body?.imageUrl || "").trim()
    if (!imageUrl) {
      res.status(400).json({ error: "imageUrl is required" })
      return
    }

    const prompt = String(req.body?.prompt || "").trim()
    const options = (req.body?.options || {}) as ImageKitTransformOptions

    const appliedTransformations = prompt ? parsePromptToTransformations(prompt) : []
    const transformedUrl = buildTransformedUrl(imageUrl, {
      ...options,
      prompt: prompt || options.prompt,
    })

    res.json({
      ok: true,
      transformedUrl,
      appliedTransformations,
    })
  } catch (err) {
    console.error("ImageKit transform failed:", err)
    res.status(500).json({ error: "Failed to transform image" })
  }
}

export async function upload(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.file) {
      const buffer = req.file.buffer
      const fileName = req.file.originalname || `upload_${Date.now()}.jpg`
      const result = await uploadToImageKit({
        file: buffer,
        fileName,
        folder: "/appforge/user-uploads",
        tags: ["appforge", "user-upload"],
      })
      res.json({ ok: true, url: result.url, fileId: result.fileId, name: result.name })
      return
    }

    const file = String(req.body?.file || "")
    if (!file) {
      res.status(400).json({ error: "File data or URL is required" })
      return
    }
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : undefined
    const result = await uploadToImageKit({
      file,
      fileName,
      folder: "/appforge/user-uploads",
      tags: ["appforge", "user-upload"],
    })

    res.json({ ok: true, url: result.url, fileId: result.fileId, name: result.name })
  } catch (err) {
    console.error("ImageKit upload failed:", err)
    res.status(500).json({ error: "Failed to upload image" })
  }
}
