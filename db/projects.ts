import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, messages, projects, type Project } from "@/db";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export type ProjectSummary = {
  id: string;
  name: string;
  prompt: string | null;
  status: string | null;
  createdAt: Date;
  assetCount: number;
  themeColor: string | null;
  previewScreens: unknown;
  isPublic: boolean;
  publicSlug: string | null;
};

/**
 * Returns the most recent 60 projects owned by a user with asset counts.
 */
export async function listProjectsForUser(userId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      prompt: projects.prompt,
      status: projects.status,
      assets: projects.assets,
      createdAt: projects.createdAt,
      themeColor: projects.themeColor,
      previewScreens: projects.previewScreens,
      isPublic: projects.isPublic,
      publicSlug: projects.publicSlug,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt))
    .limit(60);

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    prompt: p.prompt,
    status: p.status,
    createdAt: p.createdAt,
    assetCount: p.assets?.length ?? 0,
    themeColor: p.themeColor,
    previewScreens: p.previewScreens,
    isPublic: p.isPublic,
    publicSlug: p.publicSlug,
  }));
}

/**
 * Renames a project owned by the given user.
 */
export async function renameProject(projectId: string, userId: string, name: string): Promise<boolean> {
  const result = await db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id });
  return result.length > 0;
}

/**
 * Deletes a project owned by the given user. Related rows (messages, snapshots,
 * builds, backend, github link, web deployments...) cascade via FK constraints.
 * Returns the deleted project's asset keys so the caller can clean up storage.
 */
export async function deleteProjectForUser(projectId: string, userId: string): Promise<{ assetKeys: string[] } | null> {
  const [deleted] = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ assets: projects.assets });
  if (!deleted) return null;
  return { assetKeys: (deleted.assets ?? []).map((a) => a.key) };
}

/**
 * Clones a project (screens, assets list, engine...) into a new row owned by the
 * same user. The copy always starts private, with its own id and no public slug.
 */
export async function duplicateProject(projectId: string, userId: string): Promise<ProjectSummary | null> {
  const [source] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!source) return null;

  const newId = `proj-${Date.now()}-${hex(3)}`;
  const [copy] = await db
    .insert(projects)
    .values({
      id: newId,
      userId,
      name: `${source.name} (copy)`,
      tagline: source.tagline,
      description: source.description,
      category: source.category,
      platform: source.platform,
      screensCount: source.screensCount,
      status: source.status,
      themeColor: source.themeColor,
      gradient: source.gradient,
      previewScreens: source.previewScreens,
      prompt: source.prompt,
      assets: source.assets,
      engine: source.engine,
      currentVersion: source.currentVersion,
      isPublic: false,
      publicSlug: null,
    })
    .returning();

  return {
    id: copy.id,
    name: copy.name,
    prompt: copy.prompt,
    status: copy.status,
    createdAt: copy.createdAt,
    assetCount: copy.assets?.length ?? 0,
    themeColor: copy.themeColor,
    previewScreens: copy.previewScreens,
    isPublic: copy.isPublic,
    publicSlug: copy.publicSlug,
  };
}

/**
 * Turns public sharing on/off for a project. Generates a public slug the first
 * time a project is made public; the slug is kept (not rotated) once enabling again.
 */
export async function setProjectVisibility(
  projectId: string,
  userId: string,
  isPublic: boolean
): Promise<{ isPublic: boolean; publicSlug: string | null } | null> {
  const [project] = await db
    .select({ publicSlug: projects.publicSlug })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!project) return null;

  const publicSlug = isPublic ? (project.publicSlug ?? `app-${hex(5)}`) : project.publicSlug;

  await db
    .update(projects)
    .set({ isPublic, publicSlug, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  return { isPublic, publicSlug: publicSlug ?? null };
}

export type PublicProjectSummary = {
  id: string;
  name: string;
  tagline: string | null;
  themeColor: string | null;
  previewScreens: unknown;
  publicSlug: string;
};

/**
 * Returns the most recently updated public projects for the signed-out gallery.
 */
export async function listPublicProjects(limit = 24): Promise<PublicProjectSummary[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      tagline: projects.tagline,
      themeColor: projects.themeColor,
      previewScreens: projects.previewScreens,
      publicSlug: projects.publicSlug,
    })
    .from(projects)
    .where(eq(projects.isPublic, true))
    .orderBy(desc(projects.updatedAt))
    .limit(limit);

  return rows.filter((r): r is PublicProjectSummary & { publicSlug: string } => Boolean(r.publicSlug));
}

/**
 * Looks up a public project's preview data by its public slug. Returns null if
 * the project doesn't exist or isn't public (never leaks a toggled-off project).
 */
export async function getPublicProjectBySlug(slug: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      themeColor: projects.themeColor,
      previewScreens: projects.previewScreens,
    })
    .from(projects)
    .where(and(eq(projects.publicSlug, slug), eq(projects.isPublic, true)))
    .limit(1);
  return project ?? null;
}

/**
 * Looks up a project owned by a specific user by ID.
 */
export async function getProjectForUser(projectId: string, userId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      status: projects.status,
      previewScreens: projects.previewScreens,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project ?? null;
}

/**
 * Looks up the sender of the most recent message in a project.
 */
export async function getLastMessageSender(projectId: string): Promise<string | null> {
  const [last] = await db
    .select({ sender: messages.sender })
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return last?.sender ?? null;
}

/**
 * Inserts a new project and its initial message in a single transaction.
 */
export async function createProjectRecord(
  projectData: typeof projects.$inferInsert,
  messageData: typeof messages.$inferInsert
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(projects).values(projectData);
    await tx.insert(messages).values(messageData);
  });
}

/**
 * Updates the active theme on an existing project document without overwriting screens.
 */
export async function updateProjectTheme(
  projectId: string,
  userId: string,
  themeId: string,
  primaryColor: string
): Promise<void> {
  await db
    .update(projects)
    .set({
      previewScreens: sql`jsonb_set(${projects.previewScreens}, '{themes,activeId}', ${JSON.stringify(themeId)}::jsonb)`,
      themeColor: primaryColor,
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}
