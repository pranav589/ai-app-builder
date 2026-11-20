import { requireOwnedProject } from "@/lib/cloudhike/owner"
import { json } from "@/lib/http"
import { listBuildsForProject } from "@/lib/publish/builds"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const owned = await requireOwnedProject(projectId)
  if (owned.error) return owned.error

  const builds = await listBuildsForProject(projectId)
  return json({ builds })
}
