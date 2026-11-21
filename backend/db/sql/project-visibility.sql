-- Lets an owner publish a project to the signed-out homepage gallery.
-- Safe to run more than once.
alter table projects add column if not exists is_public boolean not null default false;
alter table projects add column if not exists public_slug text unique;

create index if not exists projects_is_public_idx on projects (is_public) where is_public;
