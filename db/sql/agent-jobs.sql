-- Agent runs and their streamed events (Cloudhike Jobs). Safe to run more than once.
create table if not exists agent_runs (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  kind text not null default 'agent',
  input jsonb,
  status text not null default 'queued',
  job_id text,
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);
create unique index if not exists agent_runs_one_active_per_project
  on agent_runs (project_id) where status in ('queued', 'running');
create index if not exists agent_runs_project_created on agent_runs (project_id, created_at);

create table if not exists agent_events (
  run_id text not null references agent_runs(id) on delete cascade,
  seq integer not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, seq)
);
