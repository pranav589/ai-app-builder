-- CloudHike Connect: one account connection per user, one backend per app. Safe to run more than once.
-- Tokens and project credentials are stored encrypted (lib/crypto/secret-box.ts), never in plain text.
--
-- `create table if not exists` only creates the table the first time; it never alters one that
-- already exists under an older version of this file. Every column below also gets an explicit
-- `add column if not exists`, so a table created before a column existed here still catches up.
create table if not exists cloudhike_connections (
  user_id text primary key references users(id) on delete cascade,
  access_token_enc text not null,
  mcp_url text not null,
  api_url text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table cloudhike_connections add column if not exists access_token_enc text not null default '';
alter table cloudhike_connections add column if not exists mcp_url text not null default '';
alter table cloudhike_connections add column if not exists api_url text not null default '';
alter table cloudhike_connections add column if not exists status text not null default 'active';
alter table cloudhike_connections add column if not exists created_at timestamptz not null default now();
alter table cloudhike_connections add column if not exists updated_at timestamptz not null default now();
-- Dead leftover from before the token was stored encrypted as access_token_enc: nothing
-- reads or writes it, and its NOT NULL constraint breaks every insert/update since.
alter table cloudhike_connections drop column if exists access_token;

create table if not exists app_backends (
  project_id text primary key references projects(id) on delete cascade,
  provider text not null default 'cloudhike',
  status text not null default 'provisioning',
  external_project_id text,
  external_project_name text,
  services jsonb not null default '[]'::jsonb,
  env_enc text,
  schema_hash text,
  error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_backends add column if not exists provider text not null default 'cloudhike';
alter table app_backends add column if not exists status text not null default 'provisioning';
alter table app_backends add column if not exists external_project_id text;
alter table app_backends add column if not exists external_project_name text;
alter table app_backends add column if not exists services jsonb not null default '[]'::jsonb;
alter table app_backends add column if not exists env_enc text;
alter table app_backends add column if not exists schema_hash text;
alter table app_backends add column if not exists error text;
alter table app_backends add column if not exists connected_at timestamptz;
alter table app_backends add column if not exists created_at timestamptz not null default now();
alter table app_backends add column if not exists updated_at timestamptz not null default now();
