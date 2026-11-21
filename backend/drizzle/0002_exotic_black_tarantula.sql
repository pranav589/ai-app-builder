CREATE TABLE "web_deployments" (
	"project_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"url" text,
	"repo_owner" text,
	"repo_name" text,
	"workflow_run_id" text,
	"workflow_run_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"last_deployed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cloudhike_connections" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "web_deployments" ADD CONSTRAINT "web_deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_deployments" ADD CONSTRAINT "web_deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;