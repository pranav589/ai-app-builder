-- CloudHike Connect: one account connection per user, one backend per app. Safe to run more than once.
-- Tokens and project credentials are stored encrypted (lib/crypto/secret-box.ts), never in plain text.
create table if not exists cloudhike_connections (
  user_id text primary key references users(id) on delete cascade,
  access_token_enc text not null,
  mcp_url text not null,
  api_url text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
