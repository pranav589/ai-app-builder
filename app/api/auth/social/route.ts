import { CloudHikeAuthError, getSessionUser } from "@/lib/cloudhike-auth";
import { isSameOriginJson, json, readJson, str } from "@/lib/http";
import { setSessionToken } from "@/lib/session";
import { ensureUser } from "@/lib/users";

// Exchanges the token CloudHike returns after GitHub/Google sign-in for our session cookie.
// The token is verified with CloudHike itself, so a made-up token is rejected.
export async function POST(req: Request) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400);
  const body = await readJson(req);
  const token = str(body?.token);
  if (!token || token.length > 4096) return json({ error: "Bad request" }, 400);

  try {
    const authUser = await getSessionUser(token);
    if (!authUser) return json({ error: "Sign-in expired. Try again." }, 401);
    const user = await ensureUser(authUser);
    await setSessionToken(token);
    return json({ user });
  } catch (e) {
    if (e instanceof CloudHikeAuthError) {
      return json({ error: e.message }, e.status === 503 ? 503 : e.status < 500 ? e.status : 502);
    }
    console.error("social sign-in failed", e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
