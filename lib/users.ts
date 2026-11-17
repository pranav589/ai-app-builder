import "server-only";
import { eq } from "drizzle-orm";
import { db, users, type User } from "@/db";
import type { CloudHikeUser } from "@/lib/cloudhike-auth";

export const SIGNUP_CREDITS = 100;

export type PublicUser = Pick<User, "id" | "name" | "email" | "credits">;

function toPublic(u: User): PublicUser {
  return { id: u.id, name: u.name, email: u.email, credits: u.credits };
}

/**
 * Returns the app user for a CloudHike account, creating it on first sight.
 * The signup credits are only ever written by the INSERT of a brand-new row;
 * an existing row is never updated here, so signing in again cannot grant them twice.
 */
export async function ensureUser(auth: CloudHikeUser): Promise<PublicUser> {
  const email = auth.email.trim().toLowerCase();

  await db
    .insert(users)
    .values({
      id: auth.id,
      email,
      name: auth.name?.trim() || email.split("@")[0],
      credits: SIGNUP_CREDITS,
    })
    .onConflictDoNothing();

  const [byId] = await db.select().from(users).where(eq(users.id, auth.id)).limit(1);
  if (byId) return toPublic(byId);

  // An older row for this email exists under a different id: use it as-is.
  const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (byEmail) return toPublic(byEmail);

  throw new Error("Failed to load or create user");
}
