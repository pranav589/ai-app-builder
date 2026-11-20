import { sql } from "drizzle-orm";
import { customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Mirrors the live CloudHike `users` table. `id` is the CloudHike Auth user id.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  credits: integer("credits").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ProjectAsset = {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Object key in the CloudHike Storage bucket. */
  key: string;
};

// Mirrors the live `projects` table. Not managed by drizzle-kit here (see tablesFilter).
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tagline: text("tagline"),
  description: text("description"),
  category: text("category").default("General"),
  platform: text("platform").default("iOS & Android"),
  screensCount: integer("screens_count").default(1),
  status: text("status").default("ready"),
  themeColor: text("theme_color").default("#8b5cf6"),
  gradient: text("gradient"),
  previewScreens: jsonb("preview_screens"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  prompt: text("prompt"),
  assets: jsonb("assets").$type<ProjectAsset[]>(),
  engine: text("engine").notNull().default("legacy"),
  currentVersion: integer("current_version").notNull().default(0),
});

// Mirrors the live `messages` table (the project's chat history).
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
  text: text("text").notNull(),
  plan: jsonb("plan"),
  screenGenerated: jsonb("screen_generated"),
  suggestions: jsonb("suggestions"),
  type: text("type").default("standard"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  pipelineData: jsonb("pipeline_data"),
});

export type Project = typeof projects.$inferSelect;

// ---------------------------------------------------------------- agent runs
// One row per agent run (planning, building, editing, repair). The partial
// unique index allows a single active run per project across every server
// instance and Cloudhike Jobs worker. Created by db/sql/agent-jobs.sql (npm run db:sql).
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** "agent" runs stream to the workspace; "repair" and "canvas-edit" only hold the project lock. */
    kind: text("kind").notNull().default("agent"),
    /** What the worker should do: { task, action }. */
    input: jsonb("input"),
    status: text("status").$type<AgentRunStatus>().notNull().default("queued"),
    /** Cloudhike Jobs run id; null when the run executes in-process. */
    jobId: text("job_id"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_runs_one_active_per_project")
      .on(t.projectId)
      .where(sql`status in ('queued', 'running')`),
    index("agent_runs_project_created").on(t.projectId, t.createdAt),
  ]
);

// The events a run emits, in order. The worker appends; the workspace's SSE
// stream follows them by seq, so a run streams live no matter where it runs.
export const agentEvents = pgTable(
  "agent_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    event: jsonb("event").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })]
);

export type AgentRunRow = typeof agentRuns.$inferSelect;

// ---------------------------------------------------------------- app snapshots
// Every committed version of a project's app document (lib/app-runtime/app-doc.ts).
// projects.current_version points at the head; restoring copies an older
// doc back onto the head and adds a new snapshot on top, so history is never
// rewritten. Created by db/sql/snapshots.sql (npm run db:sql).
export const appSnapshots = pgTable(
  "app_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    parentVersion: integer("parent_version"),
    doc: jsonb("doc").notNull(),
    author: text("author"),
    intent: text("intent"),
    runId: text("run_id"),
    /** Filled in from Phase 2 onward (gate results); unused until then. */
    verified: jsonb("verified"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("app_snapshots_project_version").on(t.projectId, t.version),
    index("app_snapshots_project_created").on(t.projectId, t.createdAt),
  ]
);

export type AppSnapshotRow = typeof appSnapshots.$inferSelect;

// ---------------------------------------------------------------- CloudHike backend
// Created by db/sql/cloudhike.sql (npm run db:sql). Secrets are encrypted at rest.

/** A user's CloudHike Connect authorization (one per user; connecting again replaces it). */
export const cloudhikeConnections = pgTable("cloudhike_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  mcpUrl: text("mcp_url").notNull(),
  apiUrl: text("api_url").notNull(),
  /** "active", or "revoked" once CloudHike answered 401 (the user disconnected the app). */
  status: text("status").notNull().default("active"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BackendStatus = "provisioning" | "ready" | "error";

/** The backend a generated app runs on: a CloudHike project with its services. */
export const appBackends = pgTable("app_backends", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("cloudhike"),
  status: text("status").$type<BackendStatus>().notNull().default("provisioning"),
  externalProjectId: text("external_project_id"),
  externalProjectName: text("external_project_name"),
  services: jsonb("services").$type<string[]>().notNull().default([]),
  /** The CloudHike project's environment (.env), encrypted. Server only. */
  envEnc: text("env_enc"),
  /** Data model hash the database tables were last synced to. */
  schemaHash: text("schema_hash"),
  error: text("error"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppBackendRow = typeof appBackends.$inferSelect;

// ---------------------------------------------------------------- image library
// Curated image library for seed images, pre-populated in ImageKit with category/
// description/tags and queried via Postgres full-text search.
// Created by db/sql/image-library.sql (npm run db:sql).
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const imageLibrary = pgTable(
  "image_library",
  {
    id: text("id").primaryKey(),
    imagekitFileId: text("imagekit_file_id").notNull().unique(),
    url: text("url").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    search: tsvector("search"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("image_library_search_idx").using("gin", t.search),
    index("image_library_category_idx").on(t.category),
  ]
);

export type ImageLibraryRow = typeof imageLibrary.$inferSelect;
export type NewImageLibraryRow = typeof imageLibrary.$inferInsert;

export const imageLibraryMisses = pgTable(
  "image_library_misses",
  {
    id: text("id").primaryKey(),
    query: text("query").notNull().unique(),
    collectionLabel: text("collection_label"),
    subject: text("subject"),
    hitCount: integer("hit_count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("image_library_misses_hit_count_idx").on(t.hitCount),
  ]
);

export type ImageLibraryMissRow = typeof imageLibraryMisses.$inferSelect;
export type NewImageLibraryMissRow = typeof imageLibraryMisses.$inferInsert;

// ---------------------------------------------------------------- GitHub export
export const githubConnections = pgTable("github_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  githubLogin: text("github_login").notNull(),
  githubUserId: integer("github_user_id").notNull(),
  scope: text("scope").notNull(),
  status: text("status").notNull().default("active"), // "active" | "revoked"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GithubConnectionRow = typeof githubConnections.$inferSelect;
export type NewGithubConnectionRow = typeof githubConnections.$inferInsert;

export const projectGithubLinks = pgTable("project_github_links", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  lastBranch: text("last_branch").notNull(),
  lastCommitSha: text("last_commit_sha"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectGithubLinkRow = typeof projectGithubLinks.$inferSelect;
export type NewProjectGithubLinkRow = typeof projectGithubLinks.$inferInsert;

// ---------------------------------------------------------------- Publish / EAS builds
export type BuildPlatform = "android" | "ios";
export type BuildFormat = "aab" | "apk" | "ipa";
export type BuildStatus = "queued" | "dispatching" | "building" | "ready" | "failed";

export const builds = pgTable(
  "builds",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").$type<BuildPlatform>().notNull(),
    format: text("format").$type<BuildFormat>().notNull(),
    version: text("version").notNull(),
    status: text("status").$type<BuildStatus>().notNull().default("queued"),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    workflowRunId: text("workflow_run_id"),
    workflowRunUrl: text("workflow_run_url"),
    easBuildId: text("eas_build_id"),
    artifactUrl: text("artifact_url"),
    error: text("error"),
    needsIosCredentials: integer("needs_ios_credentials").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("builds_one_active_per_target")
      .on(t.projectId, t.platform, t.format)
      .where(sql`status in ('queued', 'dispatching', 'building')`),
    index("builds_project_created").on(t.projectId, t.createdAt),
  ]
);

export type BuildRow = typeof builds.$inferSelect;
export type NewBuildRow = typeof builds.$inferInsert;

export const projectAppIdentities = pgTable("project_app_identities", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  androidPackage: text("android_package").notNull(),
  iosBundleId: text("ios_bundle_id").notNull(),
  easProjectId: text("eas_project_id"),
  expoOwner: text("expo_owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectAppIdentityRow = typeof projectAppIdentities.$inferSelect;
export type NewProjectAppIdentityRow = typeof projectAppIdentities.$inferInsert;

export const expoConnections = pgTable("expo_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  expoUsername: text("expo_username"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ExpoConnectionRow = typeof expoConnections.$inferSelect;
export type NewExpoConnectionRow = typeof expoConnections.$inferInsert;

export type WebDeployStatus = "queued" | "dispatching" | "building" | "deploying" | "ready" | "failed";

// Current-state pointer: one row per project, holding the live URL (preserved across
// republishes) and the in-flight status of whichever run `currentRunId` points at.
export const webDeployments = pgTable("web_deployments", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<WebDeployStatus>().notNull().default("queued"),
  url: text("url"), // live production URL once ready; preserved across republishes
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  workflowRunId: text("workflow_run_id"),
  workflowRunUrl: text("workflow_run_url"),
  /** The web_deploy_runs.id this pointer is currently tracking; guards against a late webhook from a superseded run. */
  currentRunId: text("current_run_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  lastDeployedAt: timestamp("last_deployed_at", { withTimezone: true }),
});

export type WebDeploymentRow = typeof webDeployments.$inferSelect;
export type NewWebDeploymentRow = typeof webDeployments.$inferInsert;

// Append-only history of web deploy attempts (one row per Publish/Republish click),
// analogous to `builds` for native builds. `webDeployments` above is the current-state
// pointer derived from the latest run; this table is what the "Deployment History" list reads.
export const webDeployRuns = pgTable(
  "web_deploy_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<WebDeployStatus>().notNull().default("queued"),
    url: text("url"),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    workflowRunId: text("workflow_run_id"),
    workflowRunUrl: text("workflow_run_url"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("web_deploy_runs_project_created").on(t.projectId, t.createdAt)]
);

export type WebDeployRunRow = typeof webDeployRuns.$inferSelect;
export type NewWebDeployRunRow = typeof webDeployRuns.$inferInsert;

