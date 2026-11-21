import type { LiveRun } from "@/lib/agent/registry"
import type { BackendProviderId, BackendService } from "@app/shared/app-backend/providers"
import type { DataModel } from "@app/shared/app-runtime/data-model-types"
import type { FileMap } from "@app/shared/verify/types"
import type { AppEnv, AppServices } from "./contract"

// A backend provider a creator can connect a generated app to. Each lives in
// its own folder next to this file (cloudhike/ today) and is listed in
// registry.ts; nothing outside its folder knows how it works. Generated apps
// always talk to this server ({ op, ...args }), so a provider never changes
// app code: it links the creator's account, sets a backend up, and answers
// the app's calls through AppServices.

/** A failed account link. `code` "invalid_grant" means the link expired; "invalid_client" means our own credentials are wrong. */
export class ConnectError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

export interface BackendProvider {
  id: BackendProviderId

  /** Linking the creator's provider account to the builder (an OAuth-style redirect and code exchange). */
  connect: {
    /** Our own client credentials are set on this server. */
    isConfigured(): boolean
    /** Where to send the browser; the provider redirects back to its callback route with `state` and a code. */
    authorizeUrl(state: string): string
    /** Exchanges the code and stores the creator's access. Throws ConnectError. */
    complete(userId: string, code: string): Promise<void>
    hasConnection(userId: string): Promise<boolean>
    /** Forgets the stored access here (the creator may also revoke it on the provider's side). */
    forget(userId: string): Promise<void>
  }

  /**
   * Sets up (or repairs) the app's backend: project, services, credentials,
   * tables. Saves the app_backends row (provider, status, envEnc), points the
   * app doc's `backend` at this provider, and streams progress to `run`.
   * Must be safe to run again.
   */
  provision(run: LiveRun, projectId: string, userId: string, services: BackendService[]): Promise<void>

  /** Creates/updates the tables for the app's data model, seeding empty ones. */
  syncSchema(env: AppEnv, model: DataModel): Promise<void>

  /** The app's data, auth and uploads on this provider. */
  runtime(input: {
    projectId: string
    env: AppEnv
    model?: DataModel | null
    fileUrl: (key: string) => string
    resetRedirect: string
  }): AppServices

  /** A stored upload, for serving from our origin. Throws a 404 AppBackendError when it doesn't exist. */
  readFile(env: AppEnv, key: string): Promise<{ body: Uint8Array; type: string }>

  /** What a ZIP/GitHub export adds so the creator can run the backend themselves: files under server/ and a README section. */
  selfHost(): { files: FileMap; readme: string }
}
