CREATE TABLE "builds" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"format" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"repo_owner" text,
	"repo_name" text,
	"workflow_run_id" text,
	"workflow_run_url" text,
	"eas_build_id" text,
	"artifact_url" text,
	"error" text,
	"needs_ios_credentials" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expo_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"expo_username" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_app_identities" (
	"project_id" text PRIMARY KEY NOT NULL,
	"android_package" text NOT NULL,
	"ios_bundle_id" text NOT NULL,
	"eas_project_id" text,
	"expo_owner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expo_connections" ADD CONSTRAINT "expo_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_app_identities" ADD CONSTRAINT "project_app_identities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "builds_one_active_per_target" ON "builds" USING btree ("project_id","platform","format") WHERE status in ('queued', 'dispatching', 'building');--> statement-breakpoint
CREATE INDEX "builds_project_created" ON "builds" USING btree ("project_id","created_at");