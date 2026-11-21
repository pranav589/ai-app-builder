// The builder's own sign-in (not a generated app's). Whatever implements this
// owns the session token kept in the session cookie, and the user id it
// returns becomes users.id, so a replacement must keep existing ids (or ship
// a migration that maps them).

export type IdentityUser = {
  id: string
  email: string
  name?: string | null
  image?: string | null
}

/** `message` is safe to show to the person signing in. */
export class IdentityError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
  }
}

export type IdentitySession = { token: string; user: IdentityUser }

export interface IdentityProvider {
  signUp(input: { name: string; email: string; password: string }): Promise<IdentitySession>
  signIn(input: { email: string; password: string }): Promise<IdentitySession>
  /** null when the token is no longer a live session; throws on a transient failure. */
  getSessionUser(token: string): Promise<IdentityUser | null>
  signOut(token: string): Promise<void>
}
