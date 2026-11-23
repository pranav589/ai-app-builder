// The backend providers a creator can connect a generated app to. Frontend
// (Connect dialog) and backend (adapter registry) both read this list, so
// offering a new provider starts with one entry here plus a server adapter in
// backend/src/services/app-backend/<id>/.

/** Every service a provider may offer; each provider picks its own subset. */
export const BACKEND_SERVICE_INFO = {
  postgres: { label: "Database", body: "Postgres for the app's records, synced live." },
  auth: { label: "Authentication", body: "Sign up, sign in and password reset for your users." },
  storage: { label: "File storage", body: "Photos and files your users upload." },
  email: { label: "Email", body: "Transactional email from your app." },
  jobs: { label: "Background jobs", body: "Scheduled and long-running tasks." },
} as const

export type BackendService = keyof typeof BACKEND_SERVICE_INFO

type ProviderInfo = {
  label: string
  /** One line for the Connect dialog. */
  tagline: string
  dashboardUrl: string
  /** Who pays for what, shown before setup. */
  billing: string
  /** Offered services, in display order. */
  services: readonly BackendService[]
  /** What the app runtime can't work without; always deployed. */
  required: readonly BackendService[]
}

export const BACKEND_PROVIDERS = {
  cloudhike: {
    label: "CloudHike",
    tagline: "Managed Postgres, Auth, Storage, Email and Jobs, in your own CloudHike workspace.",
    dashboardUrl: "https://cloudhike.dev",
    billing: "Usage is billed to your CloudHike workspace, and deploying needs about a day of the services' cost in credits.",
    services: ["postgres", "auth", "storage", "email", "jobs"],
    required: ["postgres", "auth", "storage"],
  },
} as const satisfies Record<string, ProviderInfo>

export type BackendProviderId = keyof typeof BACKEND_PROVIDERS

export const BACKEND_PROVIDER_IDS = Object.keys(BACKEND_PROVIDERS) as BackendProviderId[]

/** Used when a request or an older stored row doesn't name a provider. */
export const DEFAULT_BACKEND_PROVIDER: BackendProviderId = "cloudhike"

export function isBackendProviderId(v: unknown): v is BackendProviderId {
  return typeof v === "string" && Object.hasOwn(BACKEND_PROVIDERS, v)
}

export function providerInfo(id: BackendProviderId): ProviderInfo {
  return BACKEND_PROVIDERS[id]
}

/** The provider's services picked in `raw` (array or comma list), always including the required ones, in display order. */
export function parseServices(provider: BackendProviderId, raw: unknown): BackendService[] {
  const { services, required } = providerInfo(provider)
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []
  const picked = new Set<string>(required)
  for (const s of list) picked.add(String(s).trim())
  return services.filter((s) => picked.has(s))
}

/** Connection state of one provider for the signed-in creator. */
export type BackendProviderStatus = { id: BackendProviderId; configured: boolean; accountConnected: boolean }
