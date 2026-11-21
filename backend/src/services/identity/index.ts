import { cloudhikeIdentity } from "./cloudhike"
import type { IdentityProvider } from "./types"

export * from "./types"

/** The builder's sign-in provider. Moving to another one means implementing IdentityProvider and changing this line. */
export const identity: IdentityProvider = cloudhikeIdentity
