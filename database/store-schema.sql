-- Generic durable store backing server/store.pg.mjs.
--
-- This is deliberately NOT the normalized data model in schema.sql (see that file's header). It mirrors the
-- flat, per-collection JSON-document shape the application already uses today (server/store.json.mjs), just on
-- real Postgres instead of a single JSON file -- ACID transactions, crash safety, backups, and (via
-- claim_due_jobs) a safe multi-process scheduler claim. Adopting the fully normalized schema.sql model, if that
-- is ever done, is a separate data-migration project, not something this file attempts.

create table if not exists records (
  collection text not null,
  id text not null,
  data jsonb not null,
  owner_id text not null,
  version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists idx_records_collection on records (collection);
create index if not exists idx_records_owner on records (collection, owner_id);

-- Staff accounts (lawyer/advisor/admin) live in the 'users' collection; enforce email uniqueness at the
-- database level here (the JSON backend enforces it with an application-level check before insert instead).
create unique index if not exists idx_records_users_email on records ((data->>'email')) where collection = 'users';

create table if not exists record_history (
  collection text not null,
  record_id text not null,
  version integer not null,
  saved_at timestamptz not null default now(),
  saved_by text not null,
  snapshot jsonb not null,
  primary key (collection, record_id, version)
);

-- Append-only, and deliberately loose-shaped: audit entries come from two call sites with different fields
-- (upsertRecord/deleteRecord write {collection, recordId, action, version}; appendAudit callers write their own
-- {action, summary, ...}). `entry` holds the exact object returned to callers, same as store.json.mjs's array.
create table if not exists audit_log (
  id text primary key,
  entry jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created on audit_log (created_at);
