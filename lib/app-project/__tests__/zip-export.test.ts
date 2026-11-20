import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { buildExportFileMap, zipFileMap } from "../zip-export"

describe("zip-export", () => {
  it("buildExportFileMap merges workspace files, scaffold files, and README.md", () => {
    const inputFiles = {
      "app/index.tsx": "export default function Screen() {}",
      "package.json": '{"name": "test"}',
    }
    const result = buildExportFileMap("My Cool App", inputFiles)

    expect(result["app/index.tsx"]).toBe(inputFiles["app/index.tsx"])
    expect(result["package.json"]).toBe(inputFiles["package.json"])
    expect(result["babel.config.js"]).toBeDefined()
    expect(result["metro.config.js"]).toBeDefined()
    expect(result[".gitignore"]).toBeDefined()
    expect(result["README.md"]).toContain("# My Cool App")
  })

  it("zipFileMap creates a valid ZIP buffer that can be loaded back", async () => {
    const files = {
      "app/index.tsx": "export default function Screen() {}",
      "README.md": "# Readme Content",
    }
    const buffer = await zipFileMap(files)
    expect(Buffer.isBuffer(buffer)).toBe(true)

    const unzipped = await JSZip.loadAsync(buffer)
    const indexFile = unzipped.file("app/index.tsx")
    const readmeFile = unzipped.file("README.md")

    expect(indexFile).not.toBeNull()
    expect(readmeFile).not.toBeNull()
    expect(await indexFile!.async("string")).toBe("export default function Screen() {}")
    expect(await readmeFile!.async("string")).toBe("# Readme Content")
  })
})
