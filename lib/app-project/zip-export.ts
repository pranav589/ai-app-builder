import JSZip from "jszip"
import type { FileMap } from "@/lib/verify/types"
import { BACKEND_README } from "./backend-readme"
import { readmeFile, scaffoldFiles } from "./scaffold"
import { excludeServerFromTsconfig, selfHostFiles } from "./self-host"
import { withBackend } from "./with-backend"

/**
 * The files of a project as a standalone Expo project. An app connected to
 * CloudHike gets the backend-calling `lib/backend` (see with-backend.ts).
 * `selfHost` (ZIP and GitHub, which people take and run themselves) adds the
 * server they can run instead of using the builder's, plus the README that
 * explains both.
 */
export async function buildExportFileMap(projectId: string, projectName: string, files: FileMap, opts: { selfHost?: boolean } = {}): Promise<FileMap> {
  const backend = await withBackend(projectId, files)
  const selfHost = !!opts.selfHost && backend.connected
  const exported: FileMap = { ...backend.files, ...scaffoldFiles(null), "README.md": readmeFile(projectName, selfHost ? BACKEND_README : "") }
  if (!selfHost) return exported
  const tsconfig = excludeServerFromTsconfig(exported["tsconfig.json"])
  return { ...exported, ...selfHostFiles(), ...(tsconfig ? { "tsconfig.json": tsconfig } : {}) }
}

export async function zipFileMap(files: FileMap): Promise<Buffer> {
  const zip = new JSZip()
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content)
  }
  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
}
