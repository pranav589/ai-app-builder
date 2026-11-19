import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, messages, projects, type Project } from "@/db";

export type ProjectSummary = {
  id: string;
  name: string;
  prompt: string | null;
  status: string | null;
  createdAt: Date;
  assetCount: number;
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
  }));
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
