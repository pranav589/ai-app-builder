CREATE TABLE "agent_events" (
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text DEFAULT 'agent' NOT NULL,
	"input" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_backends" (
	"project_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'cloudhike' NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"external_project_id" text,
	"external_project_name" text,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env_enc" text,
	"schema_hash" text,
	"error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"parent_version" integer,
	"doc" jsonb NOT NULL,
	"author" text,
	"intent" text,
	"run_id" text,
	"verified" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloudhike_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"mcp_url" text NOT NULL,
	"api_url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"github_login" text NOT NULL,
	"github_user_id" integer NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_library" (
	"id" text PRIMARY KEY NOT NULL,
	"imagekit_file_id" text NOT NULL,
	"url" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"search" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_library_imagekit_file_id_unique" UNIQUE("imagekit_file_id")
);
--> statement-breakpoint
CREATE TABLE "image_library_misses" (
	"id" text PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"collection_label" text,
	"subject" text,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_library_misses_query_unique" UNIQUE("query")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sender" text NOT NULL,
	"text" text NOT NULL,
	"plan" jsonb,
	"screen_generated" jsonb,
	"suggestions" jsonb,
	"type" text DEFAULT 'standard',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"pipeline_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "project_github_links" (
	"project_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"last_branch" text NOT NULL,
	"last_commit_sha" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"tagline" text,
	"description" text,
	"category" text DEFAULT 'General',
	"platform" text DEFAULT 'iOS & Android',
	"screens_count" integer DEFAULT 1,
	"status" text DEFAULT 'ready',
	"theme_color" text DEFAULT '#8b5cf6',
	"gradient" text,
	"preview_screens" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"prompt" text,
	"assets" jsonb,
	"engine" text DEFAULT 'legacy' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"credits" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_backends" ADD CONSTRAINT "app_backends_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_snapshots" ADD CONSTRAINT "app_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloudhike_connections" ADD CONSTRAINT "cloudhike_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_per_project" ON "agent_runs" USING btree ("project_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "agent_runs_project_created" ON "agent_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_snapshots_project_version" ON "app_snapshots" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "app_snapshots_project_created" ON "app_snapshots" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "image_library_search_idx" ON "image_library" USING gin ("search");--> statement-breakpoint
CREATE INDEX "image_library_category_idx" ON "image_library" USING btree ("category");--> statement-breakpoint
CREATE INDEX "image_library_misses_hit_count_idx" ON "image_library_misses" USING btree ("hit_count");