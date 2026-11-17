import { CloudHikeAuthError, signInEmail } from "@/lib/cloudhike-auth";
import { validateCredentials } from "@/lib/auth-validation";
import { isSameOriginJson, json, readJson, str } from "@/lib/http";
import { setSessionToken } from "@/lib/session";
import { ensureUser } from "@/lib/users";

export async function POST(req: Request) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400);
  const body = await readJson(req);
  if (!body) return json({ error: "Bad request" }, 400);

  const input = { email: str(body.email).trim().toLowerCase(), password: str(body.password) };
  const fieldErrors = validateCredentials("sign-in", input);
  if (Object.keys(fieldErrors).length) return json({ error: "Check the highlighted fields", fieldErrors }, 400);

  try {
    const { token, user: authUser } = await signInEmail(input);
    const user = await ensureUser(authUser);
    await setSessionToken(token);
    return json({ user });
  } catch (e) {
    if (e instanceof CloudHikeAuthError) {
      return json({ error: e.message, code: e.code }, e.status === 503 ? 503 : e.status < 500 ? e.status : 502);
    }
    console.error("sign-in failed", e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
