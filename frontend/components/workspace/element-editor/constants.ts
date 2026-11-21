import type * as React from "react"
import {
  Box,
  Image as ImageIcon,
  Layers,
  LayoutPanelLeft,
  MousePointerClick,
  Move,
  Palette,
  Shapes,
  Square,
  TextCursorInput,
  Type,
} from "lucide-react"

import type { ElementKind } from "@app/shared/preview/element-names"
import type { Shadow, TabId } from "./types"

export const HEX6 = /^#[0-9a-f]{6}$/i

export const SHADOWS: Record<string, Shadow> = {
  small: { y: 1, blur: 3, opacity: 0.08 },
  medium: { y: 4, blur: 8, opacity: 0.12 },
  large: { y: 10, blur: 20, opacity: 0.18 },
}

export const NO_SHADOW: Shadow = { y: 0, blur: 0, opacity: 0 }

export const SHADOW_KEYS = ["shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius", "elevation"]

export const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "text", label: "Text", icon: Type },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "spacing", label: "Spacing", icon: Move },
  { id: "layout", label: "Layout", icon: LayoutPanelLeft },
  { id: "border", label: "Border", icon: Square },
  { id: "effects", label: "Effects", icon: Layers },
]

export const KIND_ICON: Record<ElementKind, React.ComponentType<{ className?: string }>> = {
  container: Box,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  icon: Shapes,
  input: TextCursorInput,
  other: Box,
}

export const SUGGESTIONS = ["Make it bigger", "Use the primary color", "Add more breathing room", "Round the corners"]

export const TRANSFORM_PRESETS = [
  { label: "🪄 Remove BG", prompt: "remove background" },
  { label: "🌆 Sunset Skyline", prompt: "change background to sunset city skyline" },
  { label: "☕ Cozy Cafe", prompt: "change background to cozy cafe with warm lighting" },
  { label: "🌿 Wooden Studio", prompt: "change background to wooden table with soft studio lighting" },
  { label: "👥 Drop Shadow", prompt: "add drop shadow" },
  { label: "📐 Generative Fill", prompt: "expand canvas with generative fill" },
  { label: "⚡ AI Upscale", prompt: "ai upscale and enhance" },
  { label: "🖤 Black & White", prompt: "make it black and white" },
]

export const GENERATE_STYLES = [
  { id: "photo", label: "Photorealistic" },
  { id: "minimal3d", label: "Minimalist 3D" },
  { id: "illustration", label: "Illustration" },
  { id: "isometric", label: "Isometric" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "watercolor", label: "Watercolor" },
]

export const QUICK_REPLACE_PRESETS = [
  { name: "Sample Product", url: "https://ik.imagekit.io/demo/img/default-image.jpg" },
  { name: "User Avatar", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80" },
  { name: "Coffee & Food", url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500&auto=format&fit=crop&q=80" },
  { name: "Tech Minimal", url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=500&auto=format&fit=crop&q=80" },
]
