import { signOutToken } from "@/lib/cloudhike-auth";
import { isSameOriginJson, json } from "@/lib/http";
import { clearSessionToken, getSessionToken } from "@/lib/session";

export async function POST(req: Request) {
  if (!isSameOriginJson(req)) return json({ error: "Bad request" }, 400);
  const token = await getSessionToken();
  if (token) await signOutToken(token).catch(() => undefined);
  await clearSessionToken();
  return json({ ok: true });
}
