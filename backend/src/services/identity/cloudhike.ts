import { IdentityError, type IdentityProvider, type IdentitySession, type IdentityUser } from "./types";

// CloudHike Auth (AUTH_URL + AUTH_PUBLISHABLE_KEY) as the builder's sign-in.

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "x-api-key": process.env.AUTH_PUBLISHABLE_KEY!,
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetch(`${process.env.AUTH_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new IdentityError("Couldn't reach the sign-in service. Try again.", 503);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    const err = (data ?? {}) as { message?: string; code?: string };
    // Only 4xx messages are meant for people; hide anything from a 5xx.
    const message =
      res.status < 500 && err.message ? err.message : "Something went wrong. Try again.";
    throw new IdentityError(message, res.status, err.code);
  }
  return data as T;
}

export const cloudhikeIdentity: IdentityProvider = {
  signUp: (input) => call<IdentitySession>("/sign-up/email", { method: "POST", body: input }),
  signIn: (input) => call<IdentitySession>("/sign-in/email", { method: "POST", body: input }),
  async getSessionUser(token) {
    const data = await call<{ user?: IdentityUser } | null>("/get-session", { token });
    return data?.user ?? null;
  },
  async signOut(token) {
    await call<unknown>("/sign-out", { method: "POST", body: {}, token });
  },
};
