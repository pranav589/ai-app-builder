import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, messages, projects, type ProjectAsset } from "@/db";
import { getCurrentUser, ServiceUnavailableError } from "@/lib/current-user";
import { isSameOrigin, json } from "@/lib/http";
import {
  MAX_ASSETS,
  MAX_PROMPT_LENGTH,
  MAX_TOTAL_BYTES,
  resolveAssetType,
  validateAsset,
} from "@/lib/project-rules";
import { generateProjectName } from "@/lib/project-name";
import { deleteObjects, putObject } from "@/lib/storage";

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

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

const safeFileName = (name: string) =>
  name.split(/[\/]/).pop()!.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "file";

export async function GET() {
  const auth = await currentUserOr503();
  if ("unavailable" in auth) return json({ error: UNAVAILABLE }, 503);
  const user = auth.user;
  if (!user) return json({ error: "Sign in to see your projects." }, 401);

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      prompt: projects.prompt,
      status: projects.status,
      assets: projects.assets,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt))
    .limit(60);

  return json({
    projects: rows.map((p) => ({ ...p, assetCount: p.assets?.length ?? 0, assets: undefined })),
  });
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

  const prompt = String(form.get("prompt") ?? "").trim();
  if (!prompt) return json({ error: "Describe the app you want to build." }, 400);
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return json({ error: `Keep your prompt under ${MAX_PROMPT_LENGTH} characters.` }, 400);
  }

  const files = form.getAll("assets").filter((f): f is File => f instanceof File);
  if (files.length > MAX_ASSETS) return json({ error: `Attach at most ${MAX_ASSETS} files.` }, 400);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
    return json({ error: "Those files are too large to upload together." }, 413);
  }
  for (const file of files) {
    const problem = validateAsset(file);
    if (problem) return json({ error: problem }, 400);
  }

  const projectId = `proj-${Date.now()}-${hex(3)}`;
  const planned = files.map((file) => {
    const id = hex(6);
    return {
      file,
      asset: {
        id,
        name: file.name,
        type: resolveAssetType(file.name, file.type)!,
        size: file.size,
        key: `users/${user.id}/projects/${projectId}/${id}-${safeFileName(file.name)}`,
      } satisfies ProjectAsset,
    };
  });
  const uploaded = planned.map((p) => p.asset);

  try {
    // Only now, on Send, do the files go to storage. Wait for every upload to settle
    // so a failure can clean up files that were still in flight.
    const results = await Promise.allSettled(
      planned.map(async ({ file, asset }) =>
        putObject(asset.key, Buffer.from(await file.arrayBuffer()), asset.type)
      )
    );
    if (results.some((r) => r.status === "rejected")) throw new Error("asset upload failed");

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        userId: user.id,
        name: generateProjectName(prompt),
        description: prompt.slice(0, 280),
        prompt,
        assets: uploaded,
        status: "draft",
        engine: "verified",
      });
      await tx.insert(messages).values({
        id: `msg-${Date.now()}-${hex(3)}`,
        projectId,
        sender: "user",
        text: prompt,
        type: "standard",
      });
    });

    return json({ projectId });
  } catch (e) {
    console.error("create project failed", e);
    // Don't leave orphaned files behind when the project wasn't created.
    await deleteObjects(uploaded.map((a) => a.key)).catch(() => undefined);
    return json({ error: "We couldn't create your project. Please try again." }, 500);
  }
}
