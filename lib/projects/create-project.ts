import "server-only";
import { randomBytes } from "node:crypto";
import { type ProjectAsset } from "@/db";
import { createProjectRecord } from "@/db/projects";
import { generateProjectName } from "@/lib/project-name";
import {
  MAX_ASSETS,
  MAX_PROMPT_LENGTH,
  MAX_TOTAL_BYTES,
  resolveAssetType,
  validateAsset,
} from "@/lib/project-rules";
import { deleteObjects, putObject } from "@/lib/storage";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

const safeFileName = (name: string) =>
  name.split(/[\/]/).pop()!.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-100) || "file";

export type CreateProjectInput = {
  prompt: string;
  files: File[];
};

export type CreateProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string; status: number };

/**
 * Validates project input, uploads assets to S3, and persists the project record.
 * Orphaned assets in storage are cleaned up if project creation fails.
 */
export async function createProject(
  userId: string,
  input: CreateProjectInput
): Promise<CreateProjectResult> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Describe the app you want to build.", status: 400 };
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `Keep your prompt under ${MAX_PROMPT_LENGTH} characters.`,
      status: 400,
    };
  }

  const { files } = input;
  if (files.length > MAX_ASSETS) {
    return { ok: false, error: `Attach at most ${MAX_ASSETS} files.`, status: 400 };
  }
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
    return { ok: false, error: "Those files are too large to upload together.", status: 413 };
  }
  for (const file of files) {
    const problem = validateAsset(file);
    if (problem) return { ok: false, error: problem, status: 400 };
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
        key: `users/${userId}/projects/${projectId}/${id}-${safeFileName(file.name)}`,
      } satisfies ProjectAsset,
    };
  });
  const uploaded = planned.map((p) => p.asset);

  try {
    const results = await Promise.allSettled(
      planned.map(async ({ file, asset }) =>
        putObject(asset.key, Buffer.from(await file.arrayBuffer()), asset.type)
      )
    );
    if (results.some((r) => r.status === "rejected")) throw new Error("asset upload failed");

    await createProjectRecord(
      {
        id: projectId,
        userId,
        name: generateProjectName(prompt),
        description: prompt.slice(0, 280),
        prompt,
        assets: uploaded,
        status: "draft",
        engine: "verified",
      },
      {
        id: `msg-${Date.now()}-${hex(3)}`,
        projectId,
        sender: "user",
        text: prompt,
        type: "standard",
      }
    );

    return { ok: true, projectId };
  } catch (e) {
    console.error("create project failed", e);
    await deleteObjects(uploaded.map((a) => a.key)).catch(() => undefined);
    return {
      ok: false,
      error: "We couldn't create your project. Please try again.",
      status: 500,
    };
  }
}
