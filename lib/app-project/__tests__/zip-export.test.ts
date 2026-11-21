import JSZip from "jszip"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildExportFileMap, zipFileMap } from "../zip-export"
import { withBackend } from "../with-backend"

vi.mock("../with-backend", () => ({ withBackend: vi.fn() }))

const notConnected = (files: Record<string, string>) => ({ files, connected: false })
const connected = (files: Record<string, string>) => ({ files: { ...files, "lib/backend/index.ts": "remote backend", "tsconfig.json": '{"extends":"expo/tsconfig.base"}' }, connected: true })

beforeEach(() => {
  vi.mocked(withBackend).mockReset()
})

describe("zip-export", () => {
  it("buildExportFileMap merges workspace files, scaffold files, and README.md", async () => {
    const inputFiles = {
      "app/index.tsx": "export default function Screen() {}",
      "package.json": '{"name": "test"}',
    }
    vi.mocked(withBackend).mockImplementation(async (_id, files) => notConnected(files))
    const result = await buildExportFileMap("p1", "My Cool App", inputFiles)

    expect(result["app/index.tsx"]).toBe(inputFiles["app/index.tsx"])
    expect(result["package.json"]).toBe(inputFiles["package.json"])
    expect(result["babel.config.js"]).toBeDefined()
    expect(result["metro.config.js"]).toBeDefined()
    expect(result[".gitignore"]).toBeDefined()
    expect(result["README.md"]).toContain("# My Cool App")
    expect(result["README.md"]).not.toContain("CloudHike")
    expect(Object.keys(result).some((p) => p.startsWith("server/"))).toBe(false)
  })

  it("a connected app's ZIP/GitHub export also gets the self-host server, env templates and README steps", async () => {
    vi.mocked(withBackend).mockImplementation(async (_id, files) => connected(files))
    const result = await buildExportFileMap("p1", "My Cool App", { "app/index.tsx": "x" }, { selfHost: true })

    expect(result["lib/backend/index.ts"]).toBe("remote backend")
    expect(result["server/index.ts"]).toContain("createServer")
    expect(result["server/.env.example"]).toContain("DATABASE_URL")
    expect(result[".env.example"]).toContain("EXPO_PUBLIC_API_URL")
    expect(result[".gitignore"]).toContain(".env")
    expect(result["README.md"]).toContain("Option B: run your own server")
    expect(JSON.parse(result["tsconfig.json"]).exclude).toContain("server")
  })

  it("a connected app's APK/web build gets the backend but not the server or its README", async () => {
    vi.mocked(withBackend).mockImplementation(async (_id, files) => connected(files))
    const result = await buildExportFileMap("p1", "My Cool App", { "app/index.tsx": "x" })

    expect(result["lib/backend/index.ts"]).toBe("remote backend")
    expect(Object.keys(result).some((p) => p.startsWith("server/"))).toBe(false)
    expect(result[".env.example"]).toBeUndefined()
    expect(result["README.md"]).not.toContain("Option B")
  })

  it("an app that isn't connected gets no server even for a ZIP/GitHub export", async () => {
    vi.mocked(withBackend).mockImplementation(async (_id, files) => notConnected(files))
    const result = await buildExportFileMap("p1", "My Cool App", { "app/index.tsx": "x" }, { selfHost: true })
    expect(Object.keys(result).some((p) => p.startsWith("server/"))).toBe(false)
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
