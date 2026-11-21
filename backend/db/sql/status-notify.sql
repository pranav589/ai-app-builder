-- Pushes "this project's build/deploy status changed" to the backend over Postgres
-- LISTEN/NOTIFY (services/http/project-events.ts), which relays it to browsers as SSE.
-- Triggers fire for every writer (webhooks, background jobs, retries), so no write path
-- has to remember to notify. NOTIFY is delivered at commit, so a listener never sees a
-- change that later rolls back. The payload is only the table and project id; clients
-- refetch the row through the normal authenticated GET. Safe to run more than once.
create or replace function notify_project_status() returns trigger as $$
begin
  -- Webhook pings and retries often rewrite a row with only a new updated_at; nothing the
  -- UI shows changed, so don't wake every open stream for it.
  if tg_op = 'UPDATE' and to_jsonb(old) - 'updated_at' = to_jsonb(new) - 'updated_at' then
    return null;
  end if;
  perform pg_notify('project_status', json_build_object('table', tg_table_name, 'projectId', new.project_id)::text);
  return null;
end;
$$ language plpgsql;

drop trigger if exists device_builds_notify on device_builds;
create trigger device_builds_notify after insert or update on device_builds
  for each row execute function notify_project_status();

drop trigger if exists builds_notify on builds;
create trigger builds_notify after insert or update on builds
  for each row execute function notify_project_status();

drop trigger if exists web_deployments_notify on web_deployments;
create trigger web_deployments_notify after insert or update on web_deployments
  for each row execute function notify_project_status();

drop trigger if exists web_deploy_runs_notify on web_deploy_runs;
create trigger web_deploy_runs_notify after insert or update on web_deploy_runs
  for each row execute function notify_project_status();
