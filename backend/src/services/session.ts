export const SESSION_COOKIE = "ch_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE * 1000;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_MS,
};
