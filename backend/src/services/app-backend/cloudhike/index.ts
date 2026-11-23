import type { BackendProvider } from "../types"
import { appServices, readFile, syncSchema } from "./app-data"
import { BACKEND_README } from "./backend-readme"
import { isConnectConfigured } from "./config"
import { authorizeUrl, completeConnect, forgetConnection, hasConnection } from "./connect"
import { runBackendSetup } from "./provision"
import { selfHostFiles } from "./self-host"

// CloudHike as a backend provider: Connect (OAuth) to link the creator's
// workspace, an AI agent on CloudHike's MCP server to provision, and Postgres +
// S3 + CloudHike Auth (from the project's environment) to serve the app.
export const cloudhikeProvider: BackendProvider = {
  id: "cloudhike",
  connect: {
    isConfigured: isConnectConfigured,
    authorizeUrl,
    complete: completeConnect,
    hasConnection,
    forget: forgetConnection,
  },
  provision: runBackendSetup,
  syncSchema,
  runtime: appServices,
  readFile,
  selfHost: () => ({ files: selfHostFiles(), readme: BACKEND_README }),
}
