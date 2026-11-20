import { listPublicProjects } from "@/db/projects"
import { json } from "@/lib/http"

export const runtime = "nodejs"

/** Public, unauthenticated list of projects owners have opted into the homepage gallery. */
export async function GET() {
  const projects = await listPublicProjects()
  return json({ projects })
}
