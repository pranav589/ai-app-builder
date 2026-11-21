-- Curated image library for seed images, pre-populated in ImageKit with
-- category/description/tags and queried via Postgres full-text search.
-- Safe to run more than once.
create extension if not exists pg_trgm;

create or replace function image_library_search_vector(tags text[], category text, description text)
returns tsvector language sql immutable parallel safe as $$
  select
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '') || ' ' || coalesce(category, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B');
$$;

create table if not exists image_library (
  id text primary key,
  imagekit_file_id text unique not null,
  url text not null,
  category text not null,
  description text,
  tags text[] not null default '{}',
  search tsvector generated always as (image_library_search_vector(tags, category, description)) stored,
  created_at timestamptz not null default now()
);

create index if not exists image_library_search_idx on image_library using gin (search);
create index if not exists image_library_category_idx on image_library (category);

create table if not exists image_library_misses (
  id text primary key,
  query text not null unique,
  collection_label text,
  subject text,
  hit_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists image_library_misses_hit_count_idx on image_library_misses (hit_count desc);
