import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
