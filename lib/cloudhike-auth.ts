import "server-only";

export type CloudHikeUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

export class CloudHikeAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

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
    throw new CloudHikeAuthError("Couldn't reach the sign-in service. Try again.", 503);
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
    throw new CloudHikeAuthError(message, res.status, err.code);
  }
  return data as T;
}

type AuthResponse = { token: string; user: CloudHikeUser };

export function signUpEmail(input: { name: string; email: string; password: string }) {
  return call<AuthResponse>("/sign-up/email", { method: "POST", body: input });
}

export function signInEmail(input: { email: string; password: string }) {
  return call<AuthResponse>("/sign-in/email", { method: "POST", body: input });
}

export async function getSessionUser(token: string): Promise<CloudHikeUser | null> {
  const data = await call<{ user?: CloudHikeUser } | null>("/get-session", { token });
  return data?.user ?? null;
}

export function signOutToken(token: string) {
  return call<unknown>("/sign-out", { method: "POST", body: {}, token });
}
