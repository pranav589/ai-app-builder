import { describe, expect, it } from "vitest"
import {
  buildTransformString,
  buildTransformedUrl,
  parsePromptToTransformations,
} from "../index"

describe("ImageKit AI Transformations", () => {
  describe("parsePromptToTransformations", () => {
    it("detects background removal", () => {
      expect(parsePromptToTransformations("remove background")).toContain("e-removedotbg")
      expect(parsePromptToTransformations("cut out subject with transparent bg")).toContain("e-removedotbg")
    })

    it("detects drop shadow", () => {
      expect(parsePromptToTransformations("add drop shadow")).toContain("e-dropshadow")
    })

    it("chains background removal and drop shadow", () => {
      const transforms = parsePromptToTransformations("remove background and add shadow")
      expect(transforms).toContain("e-removedotbg")
      expect(transforms).toContain("e-dropshadow")
    })

    it("parses generative fill", () => {
      expect(parsePromptToTransformations("expand canvas with generative fill")).toContain("bg-genfill")
    })

    it("parses AI upscale and retouch", () => {
      const transforms = parsePromptToTransformations("ai upscale and enhance with retouch")
      expect(transforms).toContain("e-upscale")
      expect(transforms).toContain("e-retouch")
    })

    it("parses monochrome / grayscale", () => {
      expect(parsePromptToTransformations("make it black and white")).toContain("e-grayscale")
    })

    it("parses background change prompt", () => {
      const transforms = parsePromptToTransformations("change background to modern luxury kitchen")
      expect(transforms.some((t) => t.startsWith("e-changebg-prompt-"))).toBe(true)
      expect(transforms).toContain("e-changebg-prompt-modern luxury kitchen")
    })

    it("handles descriptive prompt as AI scene background", () => {
      const transforms = parsePromptToTransformations("cyberpunk neon city street at night")
      expect(transforms).toContain("e-changebg-prompt-cyberpunk neon city street at night")
    })
  })

  describe("buildTransformString", () => {
    it("builds transformation string from prompt and dimensions", () => {
      const tr = buildTransformString({
        prompt: "remove background",
        shadow: true,
        width: 800,
        height: 600,
        crop: "auto",
      })
      expect(tr).toContain("e-removedotbg")
      expect(tr).toContain("e-dropshadow")
      expect(tr).toContain("w-800,h-600,fo-auto")
    })

    it("builds transformation string with background prompt", () => {
      const tr = buildTransformString({
        background: "sunset tropical beach",
        quality: 85,
      })
      expect(tr).toContain("e-changebg-prompt-sunset%20tropical%20beach")
      expect(tr).toContain("q-85")
    })
  })

  describe("buildTransformedUrl", () => {
    it("appends tr query parameter to an existing ImageKit URL", () => {
      const base = "https://ik.imagekit.io/my_id/products/shoe.jpg"
      const transformed = buildTransformedUrl(base, {
        prompt: "remove background and add shadow",
      })
      expect(transformed).toContain("https://ik.imagekit.io/my_id/products/shoe.jpg?tr=")
      expect(transformed).toContain("e-removedotbg")
      expect(transformed).toContain("e-dropshadow")
    })

    it("merges with existing tr parameters on ImageKit URL", () => {
      const base = "https://ik.imagekit.io/my_id/products/shoe.jpg?tr=w-400"
      const transformed = buildTransformedUrl(base, {
        prompt: "remove background",
      })
      expect(transformed).toContain("w-400")
      expect(transformed).toContain("e-removedotbg")
    })

    it("proxies external URLs through ImageKit endpoint", () => {
      const external = "https://images.unsplash.com/photo-1234?auto=format"
      const transformed = buildTransformedUrl(external, {
        prompt: "remove background",
      })
      expect(transformed).toContain("imagekit.io")
      expect(transformed).toContain("e-removedotbg")
    })
  })
})
