import { identity } from "@/lib/identity";
import { ensureUser, type PublicUser } from "@/lib/users";

export class ServiceUnavailableError extends Error {}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The signed-in user for this request.
 * Returns null ONLY when the visitor is definitely signed out (no session, or the identity
 * provider says the session is gone). A transient failure there or in the database is retried
 * once, then thrown as ServiceUnavailableError.
 */
export async function getCurrentUser(explicitToken?: string | null): Promise<PublicUser | null> {
  const token = explicitToken ?? null;
  if (!token) return null;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const authUser = await identity.getSessionUser(token);
      // A just-issued session can briefly read as empty; confirm once before giving up.
      if (!authUser && attempt === 0) {
        await wait(250);
        continue;
      }
      return authUser ? await ensureUser(authUser) : null;
    } catch (e) {
      lastError = e;
      if (attempt === 0) await wait(250);
    }
  }
  console.error("getCurrentUser failed", lastError);
  throw new ServiceUnavailableError("Could not verify the session");
}
