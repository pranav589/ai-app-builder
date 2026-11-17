-- Versioned app documents (undo/history). Safe to run more than once.
create table if not exists app_snapshots (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  version integer not null,
  parent_version integer,
  doc jsonb not null,
  author text,
  intent text,
  run_id text,
  verified jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists app_snapshots_project_version on app_snapshots (project_id, version);
create index if not exists app_snapshots_project_created on app_snapshots (project_id, created_at);
