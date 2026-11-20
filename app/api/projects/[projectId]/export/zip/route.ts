import { readAppDoc } from "@/lib/app-runtime/app-doc"
import { slug } from "@/lib/app-project/scaffold"
import { buildExportFileMap, zipFileMap } from "@/lib/app-project/zip-export"
import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { workspaceFromDoc } from "@/lib/verify/workspace"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const doc = readAppDoc(owned.project.previewScreens)
  const { files } = workspaceFromDoc(doc)
  const exportFiles = buildExportFileMap(owned.project.name, files)
  const zip = await zipFileMap(exportFiles)

  const filename = `${slug(owned.project.name)}.zip`

  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
}
