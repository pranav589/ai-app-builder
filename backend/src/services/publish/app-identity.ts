import { eq } from "drizzle-orm"
import { db, projectAppIdentities, type ProjectAppIdentityRow } from "@/db"

export async function ensureAppIdentity(
  projectId: string,
  appJsonText?: string
): Promise<ProjectAppIdentityRow> {
  const [existing] = await db
    .select()
    .from(projectAppIdentities)
    .where(eq(projectAppIdentities.projectId, projectId))
    .limit(1)

  if (existing) {
    return existing
  }

  let androidPackage = ""
  let iosBundleId = ""

  if (appJsonText) {
    try {
      const parsed = JSON.parse(appJsonText)
      if (parsed?.expo?.android?.package) {
        androidPackage = String(parsed.expo.android.package)
      }
      if (parsed?.expo?.ios?.bundleIdentifier) {
        iosBundleId = String(parsed.expo.ios.bundleIdentifier)
      }
    } catch {}
  }

  const cleanId = projectId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  if (!androidPackage) {
    androidPackage = `com.anything.app${cleanId}`
  }
  if (!iosBundleId) {
    iosBundleId = `com.anything.app${cleanId}`
  }

  const [created] = await db
    .insert(projectAppIdentities)
    .values({
      projectId,
      androidPackage,
      iosBundleId,
    })
    .onConflictDoUpdate({
      target: projectAppIdentities.projectId,
      set: {
        updatedAt: new Date(),
      },
    })
    .returning()

  return created
}

export async function updateEasProject(
  projectId: string,
  opts: { easProjectId?: string | null; expoOwner?: string | null }
): Promise<void> {
  const updateData: Partial<typeof projectAppIdentities.$inferInsert> = {
    updatedAt: new Date(),
  }
  if (opts.easProjectId) updateData.easProjectId = opts.easProjectId
  if (opts.expoOwner) updateData.expoOwner = opts.expoOwner

  await db
    .update(projectAppIdentities)
    .set(updateData)
    .where(eq(projectAppIdentities.projectId, projectId))
}
