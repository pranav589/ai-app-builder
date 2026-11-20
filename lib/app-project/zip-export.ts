import JSZip from "jszip"
import type { FileMap } from "@/lib/verify/types"
import { readmeFile, scaffoldFiles } from "./scaffold"

export function buildExportFileMap(projectName: string, files: FileMap): FileMap {
  return { ...files, ...scaffoldFiles(null), "README.md": readmeFile(projectName) }
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
