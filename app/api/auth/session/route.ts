import { getSessionUser } from "@/lib/cloudhike-auth";
import { json } from "@/lib/http";
import { clearSessionToken, getSessionToken } from "@/lib/session";
import { ensureUser } from "@/lib/users";

export async function GET() {
  const token = await getSessionToken();
  if (!token) return json({ user: null });

  try {
    const authUser = await getSessionUser(token);
    if (!authUser) {
      await clearSessionToken();
      return json({ user: null });
    }
    return json({ user: await ensureUser(authUser) });
  } catch (e) {
    // Transient failure: keep the cookie, report signed-out for this request only.
    console.error("session lookup failed", e);
    return json({ user: null }, 503);
  }
}
