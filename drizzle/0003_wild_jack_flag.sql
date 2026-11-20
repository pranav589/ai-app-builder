CREATE TABLE "web_deploy_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"url" text,
	"repo_owner" text,
	"repo_name" text,
	"workflow_run_id" text,
	"workflow_run_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "web_deployments" ADD COLUMN "current_run_id" text;--> statement-breakpoint
ALTER TABLE "web_deploy_runs" ADD CONSTRAINT "web_deploy_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_deploy_runs" ADD CONSTRAINT "web_deploy_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_deploy_runs_project_created" ON "web_deploy_runs" USING btree ("project_id","created_at");