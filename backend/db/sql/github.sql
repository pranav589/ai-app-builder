-- GitHub Export: account connection per user, repository link per project. Safe to run more than once.
-- Tokens are stored encrypted (lib/crypto/secret-box.ts), never in plain text.
create table if not exists github_connections (
  user_id text primary key references users(id) on delete cascade,
  access_token_enc text not null,
  github_login text not null,
  github_user_id integer not null,
  scope text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table github_connections add column if not exists access_token_enc text not null default '';
alter table github_connections add column if not exists github_login text not null default '';
alter table github_connections add column if not exists github_user_id integer not null default 0;
alter table github_connections add column if not exists scope text not null default 'repo';
alter table github_connections add column if not exists status text not null default 'active';
alter table github_connections add column if not exists created_at timestamptz not null default now();
alter table github_connections add column if not exists updated_at timestamptz not null default now();

create table if not exists project_github_links (
  project_id text primary key references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  last_branch text not null,
  last_commit_sha text,
  updated_at timestamptz not null default now()
);

alter table project_github_links add column if not exists repo_owner text not null default '';
alter table project_github_links add column if not exists repo_name text not null default '';
alter table project_github_links add column if not exists last_branch text not null default '';
alter table project_github_links add column if not exists last_commit_sha text;
alter table project_github_links add column if not exists updated_at timestamptz not null default now();
