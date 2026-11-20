import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations use the direct connection, not the pooler.
    url: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
  },
  // The database is shared with other tables (projects, messages, ...) that are only
  // mirrored in db/schema.ts for querying. Only ever let drizzle-kit manage `users` and the agent run tables.
  tablesFilter: ["users", "agent_runs", "agent_events", "cloudhike_connections", "app_backends", "builds", "project_app_identities", "expo_connections"],
});
