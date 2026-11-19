import { listProjectsForUser } from "@/db/projects";
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user";
import { isSameOrigin, json } from "@/lib/http";
import { MAX_TOTAL_BYTES } from "@/lib/project-rules";
import { createProject } from "@/lib/projects/create-project";

const UNAVAILABLE = "We're having trouble reaching our servers. Please try again in a moment.";

// null = signed out; throws are mapped to a retryable 503 by the callers.
async function currentUserOr503() {
  try {
    return { user: await getCurrentUser() };
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return { unavailable: true as const };
    throw e;
  }
}

export async function GET() {
  const auth = await currentUserOr503();
  if ("unavailable" in auth) return json({ error: UNAVAILABLE }, 503);
  const user = auth.user;
  if (!user) return json({ error: "Sign in to see your projects." }, 401);

  const projects = await listProjectsForUser(user.id);
  return json({ projects });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Bad request" }, 400);

  const auth = await currentUserOr503();
  if ("unavailable" in auth) return json({ error: UNAVAILABLE }, 503);
  const user = auth.user;
  if (!user) return json({ error: "Sign in to create a project." }, 401);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_TOTAL_BYTES + 1024 * 1024) {
    return json({ error: "Those files are too large to upload together." }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const prompt = String(form.get("prompt") ?? "");
  const files = form.getAll("assets").filter((f): f is File => f instanceof File);

  const result = await createProject(user.id, { prompt, files });
  if (!result.ok) {
    return json({ error: result.error }, result.status);
  }

  return json({ projectId: result.projectId });
}
