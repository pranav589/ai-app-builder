import JSZip from "jszip"
import type { FileMap } from "@app/shared/verify/types"
import { readmeFile, scaffoldFiles } from "@app/shared/app-project/scaffold"
import { withBackend } from "./with-backend"

/**
 * The files of a project as a standalone Expo project. An app connected to a
 * backend provider gets the backend-calling `lib/backend` (see with-backend.ts).
 * `selfHost` (ZIP and GitHub, which people take and run themselves) adds the
 * provider's server they can run instead of using the builder's, plus the
 * README that explains both.
 */
export async function buildExportFileMap(projectId: string, projectName: string, files: FileMap, opts: { selfHost?: boolean } = {}): Promise<FileMap> {
  const backend = await withBackend(projectId, files)
  const selfHost = opts.selfHost && backend.provider ? backend.provider.selfHost() : null
  const exported: FileMap = { ...backend.files, ...scaffoldFiles(null), "README.md": readmeFile(projectName, selfHost?.readme ?? "") }
  if (!selfHost) return exported
  const tsconfig = excludeServerFromTsconfig(exported["tsconfig.json"])
  return { ...exported, ...selfHost.files, ...(tsconfig ? { "tsconfig.json": tsconfig } : {}) }
}

/** The app's tsconfig globs every .ts file; a self-host server (under server/) isn't part of the app's type-check. */
export function excludeServerFromTsconfig(tsconfig: string | undefined): string | undefined {
  if (!tsconfig) return tsconfig
  try {
    return JSON.stringify({ ...JSON.parse(tsconfig), exclude: ["server", "node_modules"] }, null, 2) + "\n"
  } catch {
    return tsconfig
  }
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
