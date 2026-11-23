import { DEFAULT_BACKEND_PROVIDER, isBackendProviderId, type BackendProviderId } from "@app/shared/app-backend/providers"
import { cloudhikeProvider } from "./cloudhike"
import type { BackendProvider } from "./types"

// Every backend provider the builder can connect apps to. Adding one: an
// entry in shared/app-backend/providers.ts, an adapter folder implementing
// BackendProvider, and a line here.
const PROVIDERS: Record<BackendProviderId, BackendProvider> = {
  cloudhike: cloudhikeProvider,
}

export function listProviders(): BackendProvider[] {
  return Object.values(PROVIDERS)
}

/** The provider named in a request; unknown names are a 404. */
export function getProvider(id: unknown): BackendProvider {
  if (!isBackendProviderId(id)) throw Object.assign(new Error("Unknown backend provider."), { status: 404 })
  return PROVIDERS[id]
}

/** The provider a stored app_backends row was set up with. */
export function providerFor(row: { provider: string }): BackendProvider {
  return PROVIDERS[isBackendProviderId(row.provider) ? row.provider : DEFAULT_BACKEND_PROVIDER]
}
