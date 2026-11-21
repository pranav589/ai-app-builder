import * as React from "react"
import { Check, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, Sparkles, Upload, Wand2 } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiClient } from "@/lib/api-client"
import { GENERATE_STYLES, QUICK_REPLACE_PRESETS, TRANSFORM_PRESETS } from "./constants"
import { Segmented } from "./controls"

interface ImageSectionProps {
  currentImage: string
  origImage: string
  onApplyImageSrc: (url: string) => void
  onRevertImage: () => void
}

export function ImageSection({ currentImage, origImage, onApplyImageSrc, onRevertImage }: ImageSectionProps) {
  const [imageMode, setImageMode] = React.useState<"transform" | "generate" | "replace">("transform")
  const [transformPrompt, setTransformPrompt] = React.useState("")
  const [generatePrompt, setGeneratePrompt] = React.useState("")
  const [generateStyle, setGenerateStyle] = React.useState("photo")
  const [replaceUrl, setReplaceUrl] = React.useState("")
  const [imageLoading, setImageLoading] = React.useState(false)
  const [imageError, setImageError] = React.useState<string | null>(null)
  const [imageSuccess, setImageSuccess] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const applyWithSuccess = (url: string) => {
    onApplyImageSrc(url)
    setImageSuccess("Image updated!")
    setTimeout(() => setImageSuccess(null), 3000)
  }

  const handleApplyTransform = async (customPrompt?: string) => {
    const promptToUse = customPrompt || transformPrompt
    if (!promptToUse.trim()) return
    setImageLoading(true)
    setImageError(null)
    setImageSuccess(null)
    try {
      const fallbackBase = "https://ik.imagekit.io/demo/img/default-image.jpg"
      const res = await apiClient.post<{ ok: boolean; transformedUrl: string; error?: string }>(
        "/api/imagekit/transform",
        {
          imageUrl: currentImage || fallbackBase,
          prompt: promptToUse,
        }
      )
      if (res.data.transformedUrl) {
        applyWithSuccess(res.data.transformedUrl)
      } else {
        setImageError(res.data.error || "Failed to transform image")
      }
    } catch (e: unknown) {
      console.error("ImageKit transform failed", e)
      const err = e as { response?: { data?: { error?: string } } }
      setImageError(err?.response?.data?.error || "Failed to apply transformation. Please try again.")
    } finally {
      setImageLoading(false)
    }
  }

  const handleGenerateImage = async () => {
    if (!generatePrompt.trim()) return
    setImageLoading(true)
    setImageError(null)
    setImageSuccess(null)
    try {
      const res = await apiClient.post<{ ok: boolean; imageUrl: string; error?: string }>(
        "/api/imagekit/generate",
        {
          prompt: generatePrompt,
          style: generateStyle,
        }
      )
      if (res.data.imageUrl) {
        applyWithSuccess(res.data.imageUrl)
      } else {
        setImageError(res.data.error || "Failed to generate image")
      }
    } catch (e: unknown) {
      console.error("ImageKit generation failed", e)
      const err = e as { response?: { data?: { error?: string } } }
      setImageError(err?.response?.data?.error || "Failed to generate AI image. Please try again.")
    } finally {
      setImageLoading(false)
    }
  }

  const handleReplaceWithUrl = (urlToUse?: string) => {
    const targetUrl = (urlToUse || replaceUrl).trim()
    if (!targetUrl) return
    applyWithSuccess(targetUrl)
    setReplaceUrl("")
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageLoading(true)
    setImageError(null)
    setImageSuccess(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await apiClient.post<{ ok: boolean; url: string; error?: string }>(
        "/api/imagekit/upload",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      )
      if (res.data.url) {
        applyWithSuccess(res.data.url)
      } else {
        setImageError(res.data.error || "Failed to upload image")
      }
    } catch (e: unknown) {
      console.error("ImageKit upload failed", e)
      const err = e as { response?: { data?: { error?: string } } }
      setImageError(err?.response?.data?.error || "Failed to upload image. Please try again.")
    } finally {
      setImageLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-3">
      {/* Action Mode Switcher */}
      <Segmented
        label="Image action"
        className="w-full"
        value={imageMode}
        options={[
          { value: "transform", label: "AI Transform", icon: Sparkles },
          { value: "generate", label: "Generate AI", icon: Wand2 },
          { value: "replace", label: "Replace", icon: RefreshCw },
        ]}
        onChange={(v) => {
          setImageMode(v as "transform" | "generate" | "replace")
          setImageError(null)
          setImageSuccess(null)
        }}
      />

      {/* Current Image Card */}
      <div className="flex items-center gap-2.5 rounded-(--r-md) border border-border bg-muted/40 p-2">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-[calc(var(--r-md)-2px)] border border-border bg-background">
          {currentImage ? (
            <img
              src={currentImage}
              alt="Current element"
              className="size-full object-cover"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).src = "https://ik.imagekit.io/demo/img/default-image.jpg"
              }}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold">
              {currentImage?.includes("imagekit.io") ? "ImageKit Active" : "Selected Image"}
            </span>
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
              ImageKit AI
            </span>
          </div>
          <p className="truncate text-[10px] text-muted-foreground" title={currentImage}>
            {currentImage ? currentImage.replace(/^https?:\/\//, "") : "No image URL"}
          </p>
        </div>
        {currentImage !== origImage && origImage && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Revert to original image"
            onClick={onRevertImage}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Option 1: AI Transformation */}
      {imageMode === "transform" && (
        <div className="space-y-2.5 animate-in fade-in-50 duration-150">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Sparkles className="size-3.5 text-primary" /> Transform with ImageKit AI
            </label>
            <p className="text-[11px] text-muted-foreground">
              Describe how to transform this image (background, shadow, fill, upscale).
            </p>
          </div>

          <div className="rounded-(--r-md) border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <textarea
              rows={2}
              value={transformPrompt}
              placeholder="e.g. 'remove background and add shadow' or 'change background to sunset city'..."
              aria-label="ImageKit AI transformation prompt"
              onChange={(e) => setTransformPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (transformPrompt.trim() && !imageLoading) void handleApplyTransform()
                }
              }}
              className="block w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">Quick transformations:</span>
            <div className="flex flex-wrap gap-1">
              {TRANSFORM_PRESETS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    setTransformPrompt(q.prompt)
                    void handleApplyTransform(q.prompt)
                  }}
                  disabled={imageLoading}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground active:scale-95 disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            disabled={imageLoading || !transformPrompt.trim()}
            onClick={() => void handleApplyTransform()}
            className="w-full h-8 text-xs font-medium bg-linear-to-r from-primary to-violet-600 text-primary-foreground shadow-sm hover:brightness-110"
          >
            {imageLoading ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Transforming with ImageKit AI...
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 size-3.5" />
                Apply AI Transformation
              </>
            )}
          </Button>
        </div>
      )}

      {/* Option 2: Generate AI Image */}
      {imageMode === "generate" && (
        <div className="space-y-2.5 animate-in fade-in-50 duration-150">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Wand2 className="size-3.5 text-primary" /> Generate AI Image
            </label>
            <p className="text-[11px] text-muted-foreground">
              Generate a new image and manage/transform it via ImageKit.
            </p>
          </div>

          <div className="rounded-(--r-md) border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <textarea
              rows={2}
              value={generatePrompt}
              placeholder="e.g. 'Fresh avocado toast with poached egg on marble counter'..."
              aria-label="Generate AI image prompt"
              onChange={(e) => setGeneratePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (generatePrompt.trim() && !imageLoading) void handleGenerateImage()
                }
              }}
              className="block w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">Visual Style:</span>
            <div className="flex flex-wrap gap-1">
              {GENERATE_STYLES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setGenerateStyle(st.id)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    generateStyle === st.id
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            disabled={imageLoading || !generatePrompt.trim()}
            onClick={() => void handleGenerateImage()}
            className="w-full h-8 text-xs font-medium bg-linear-to-r from-violet-600 to-indigo-600 text-white shadow-sm hover:brightness-110"
          >
            {imageLoading ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Generating & Hosting with ImageKit...
              </>
            ) : (
              <>
                <Wand2 className="mr-1.5 size-3.5" />
                Generate AI Image
              </>
            )}
          </Button>
        </div>
      )}

      {/* Option 3: Replace Image */}
      {imageMode === "replace" && (
        <div className="space-y-2.5 animate-in fade-in-50 duration-150">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center gap-1">
              <RefreshCw className="size-3.5 text-primary" /> Replace Image
            </label>
            <p className="text-[11px] text-muted-foreground">
              Upload from your computer to ImageKit or provide an image URL.
            </p>
          </div>

          {/* Upload file to ImageKit */}
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFileUpload(e)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={imageLoading}
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-8 text-xs font-medium border-dashed hover:border-primary/60"
          >
            {imageLoading ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Uploading to ImageKit...
              </>
            ) : (
              <>
                <Upload className="mr-1.5 size-3.5" />
                Upload Image File
              </>
            )}
          </Button>

          {/* Enter URL */}
          <div className="flex gap-1.5">
            <Input
              value={replaceUrl}
              onChange={(e) => setReplaceUrl(e.target.value)}
              placeholder="Paste image URL (https://...)"
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && replaceUrl.trim()) {
                  e.preventDefault()
                  handleReplaceWithUrl()
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!replaceUrl.trim()}
              onClick={() => handleReplaceWithUrl()}
              className="h-8 shrink-0 text-xs px-2.5"
            >
              Apply
            </Button>
          </div>

          {/* Curated Presets */}
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">Curated Presets:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_REPLACE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleReplaceWithUrl(p.url)}
                  className="flex items-center gap-1.5 rounded-(--r-md) border border-border p-1 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                >
                  <img src={p.url} alt={p.name} className="size-6 rounded object-cover shrink-0" />
                  <span className="truncate text-[10px] font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Feedback States */}
      {imageSuccess && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium animate-in fade-in-50">
          <Check className="size-3 shrink-0" /> {imageSuccess}
        </p>
      )}
      {imageError && (
        <p className="text-[11px] text-destructive leading-tight">{imageError}</p>
      )}
    </div>
  )
}
