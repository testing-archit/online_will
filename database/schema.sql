-- Octaraa Online Wills foundation schema.
-- PostgreSQL 15+ recommended. Historical/version tables are append-only by trigger.
--
-- Status: this is a normalized target model for a future data-migration project (decomposing the app's current
-- flat willData JSON blob into these ~20 relational tables). Nothing in the application is wired to this file
-- today. The database the app actually runs on when DATABASE_URL is set is database/store-schema.sql, via
-- server/store.pg.mjs -- a much simpler schema that mirrors the existing per-collection JSON-document model.
-- Treat this file as a deliberate future plan, not a description of current behaviour.

create extension if not exists pgcrypto;

create type person_relationship as enum (
  'self',
  'spouse',
  'child',
  'parent',
  'sibling',
  'relative',
  'friend',
  'professional',
  'charity',
  'other'
);

create type asset_type as enum (
  'immovable_property',
  'bank_account',
  'fixed_deposit',
  'demat_account',
  'mutual_fund',
  'stock',
  'bond',
  'retirement_account',
  'insurance',
  'business_interest',
  'vehicle',
  'jewellery',
  'artwork',
  'digital_asset',
  'other'
);

create type liability_type as enum (
  'mortgage',
  'home_loan',
  'vehicle_loan',
  'personal_loan',
  'business_loan',
  'credit_card',
  'pledge',
  'tax',
  'other'
);

create type document_type as enum (
  'identity',
  'address_proof',
  'asset_proof',
  'liability_proof',
  'insurance_policy',
  'nomination_form',
  'medical_certificate',
  'draft_will',
  'executed_will',
  'codicil',
  'execution_video',
  'other'
);

create type will_status as enum (
  'draft',
  'ready_for_review',
  'reviewed',
  'ready_for_execution',
  'executed',
  'revoked',
  'archived'
);

create type distribution_type as enum (
  'all_in_one',
  'itemized',
  'percentage',
  'residuary',
  'fallback',
  'simultaneous_death',
  'future_asset'
);

create type ai_artifact_type as enum (
  'entity_extraction',
  'legal_flag',
  'risk_summary',
  'draft_clause',
  'draft_document',
  'completion_hint',
  'review_note'
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function prevent_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Historical/version rows are immutable';
end;
$$;

create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  full_name text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table family (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  display_name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table family_member (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  user_id uuid references app_user(id),
  full_name text not null,
  relationship_to_user person_relationship not null,
  date_of_birth date,
  is_minor boolean,
  address jsonb not null default '{}'::jsonb,
  identity jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table questionnaire_submission (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  family_id uuid references family(id),
  schema_id text not null,
  schema_version integer not null,
  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  current_answer_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table questionnaire_answer_version (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references questionnaire_submission(id),
  version_number integer not null,
  answers jsonb not null,
  visible_question_ids text[] not null default '{}',
  completion_by_section jsonb not null default '{}'::jsonb,
  source text not null default 'user',
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  unique (submission_id, version_number)
);

create table asset (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  asset_type asset_type not null,
  display_name text not null,
  description text,
  estimated_value numeric(18, 2),
  currency char(3) not null default 'INR',
  location jsonb not null default '{}'::jsonb,
  identifiers jsonb not null default '{}'::jsonb,
  instructions text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table asset_version (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references asset(id),
  version_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references app_user(id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (asset_id, version_number)
);

create table asset_ownership (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references asset(id),
  family_member_id uuid not null references family_member(id),
  ownership_percentage numeric(5, 2) not null check (ownership_percentage > 0 and ownership_percentage <= 100),
  ownership_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (asset_id, family_member_id)
);

create table liability (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  liability_type liability_type not null,
  lender_name text,
  account_reference text,
  outstanding_amount numeric(18, 2),
  currency char(3) not null default 'INR',
  settlement_instructions text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table liability_version (
  id uuid primary key default gen_random_uuid(),
  liability_id uuid not null references liability(id),
  version_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references app_user(id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (liability_id, version_number)
);

create table asset_liability (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references asset(id),
  liability_id uuid not null references liability(id),
  created_at timestamptz not null default now(),
  unique (asset_id, liability_id)
);

create table insurance_policy (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  asset_id uuid references asset(id),
  insurer text not null,
  policy_number text not null,
  policyholder_id uuid references family_member(id),
  sum_assured numeric(18, 2),
  currency char(3) not null default 'INR',
  maturity_date date,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (family_id, insurer, policy_number)
);

create table insurance_policy_version (
  id uuid primary key default gen_random_uuid(),
  insurance_policy_id uuid not null references insurance_policy(id),
  version_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references app_user(id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (insurance_policy_id, version_number)
);

create table nomination (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  asset_id uuid references asset(id),
  insurance_policy_id uuid references insurance_policy(id),
  nominee_family_member_id uuid references family_member(id),
  nominee_name text,
  nominee_relationship person_relationship,
  share_percentage numeric(5, 2) check (share_percentage > 0 and share_percentage <= 100),
  is_beneficial_owner boolean,
  notes text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (asset_id is not null or insurance_policy_id is not null),
  check (nominee_family_member_id is not null or nominee_name is not null)
);

create table nomination_version (
  id uuid primary key default gen_random_uuid(),
  nomination_id uuid not null references nomination(id),
  version_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references app_user(id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (nomination_id, version_number)
);

create table will (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  family_id uuid not null references family(id),
  questionnaire_submission_id uuid references questionnaire_submission(id),
  status will_status not null default 'draft',
  title text not null default 'Last Will and Testament',
  governing_religion text,
  governing_state text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table will_version (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  version_number integer not null,
  status will_status not null,
  questionnaire_answer_version_id uuid references questionnaire_answer_version(id),
  snapshot jsonb not null,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  unique (will_id, version_number)
);

create table document (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  will_id uuid references will(id),
  family_member_id uuid references family_member(id),
  asset_id uuid references asset(id),
  liability_id uuid references liability(id),
  insurance_policy_id uuid references insurance_policy(id),
  document_type document_type not null,
  title text not null,
  storage_uri text not null,
  mime_type text,
  sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table document_version (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id),
  version_number integer not null,
  storage_uri text not null,
  sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create table beneficiary (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  family_member_id uuid references family_member(id),
  display_name text not null,
  relationship person_relationship,
  is_charity boolean not null default false,
  charity_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table executor (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  family_member_id uuid references family_member(id),
  display_name text not null,
  relationship person_relationship,
  is_alternate boolean not null default false,
  priority integer not null default 1,
  compensation_terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table guardian (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  child_family_member_id uuid references family_member(id),
  guardian_family_member_id uuid references family_member(id),
  display_name text not null,
  relationship person_relationship,
  is_alternate boolean not null default false,
  priority integer not null default 1,
  financial_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table distribution_instruction (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  instruction_type distribution_type not null,
  asset_id uuid references asset(id),
  beneficiary_id uuid references beneficiary(id),
  substitute_beneficiary_id uuid references beneficiary(id),
  share_percentage numeric(5, 2) check (share_percentage > 0 and share_percentage <= 100),
  instruction_text text,
  priority integer not null default 1,
  conditions jsonb not null default '{}'::jsonb,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table distribution_instruction_version (
  id uuid primary key default gen_random_uuid(),
  distribution_instruction_id uuid not null references distribution_instruction(id),
  version_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references app_user(id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (distribution_instruction_id, version_number)
);

create table execution_event (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  event_type text not null,
  event_at timestamptz,
  location jsonb not null default '{}'::jsonb,
  witness_1_family_member_id uuid references family_member(id),
  witness_2_family_member_id uuid references family_member(id),
  witness_details jsonb not null default '{}'::jsonb,
  registration_details jsonb not null default '{}'::jsonb,
  video_document_id uuid references document(id),
  notes text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table execution_event_version (
  id uuid primary key default gen_random_uuid(),
  execution_event_id uuid not null references execution_event(id),
  version_number integer not null,
  snapshot jsonb not null,
  changed_by uuid references app_user(id),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (execution_event_id, version_number)
);

create table ai_artifact (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  family_id uuid references family(id),
  will_id uuid references will(id),
  questionnaire_submission_id uuid references questionnaire_submission(id),
  questionnaire_answer_version_id uuid references questionnaire_answer_version(id),
  artifact_type ai_artifact_type not null,
  model_name text,
  model_version text,
  prompt_version text,
  source_hash text,
  payload jsonb not null,
  confidence numeric(5, 4) check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references app_user(id),
  family_id uuid references family(id),
  entity_table text not null,
  entity_id uuid not null,
  action text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table estate_copilot_message (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  user_question text not null,
  retrieved_context jsonb not null default '{}'::jsonb,
  answer text not null,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);

create table estate_scenario_simulation (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  scenario text not null,
  deterministic_outcome text not null,
  input_snapshot jsonb not null,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);

create table estate_follow_up_question (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  question text not null,
  source text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table collaboration_message (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  sender_user_id uuid references app_user(id),
  sender_role text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table execution_checklist_item (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  label text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table execution_room (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  status text not null default 'planning',
  notes text,
  appointment_at timestamptz,
  participants jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table execution_recording (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  document_id uuid references document(id),
  metadata jsonb not null default '{}'::jsonb,
  observable_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table digital_asset_instruction (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  will_id uuid references will(id),
  account_type text not null,
  provider text,
  location_hint text,
  instruction text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table estate_review_event (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id),
  will_id uuid references will(id),
  trigger text not null,
  due_date date not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table post_death_executor_workflow (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references will(id),
  executor_family_member_id uuid references family_member(id),
  status text not null default 'not_started',
  death_reported_at timestamptz,
  executor_authenticated_at timestamptz,
  inventory_snapshot jsonb not null default '{}'::jsonb,
  distribution_tracking jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_family_user_id on family(user_id);
create index idx_family_member_family_id on family_member(family_id);
create index idx_questionnaire_submission_user_id on questionnaire_submission(user_id);
create index idx_questionnaire_answer_submission_id on questionnaire_answer_version(submission_id);
create index idx_asset_family_id on asset(family_id);
create index idx_asset_ownership_asset_id on asset_ownership(asset_id);
create index idx_liability_family_id on liability(family_id);
create index idx_insurance_policy_family_id on insurance_policy(family_id);
create index idx_nomination_family_id on nomination(family_id);
create index idx_will_family_id on will(family_id);
create index idx_document_family_id on document(family_id);
create index idx_beneficiary_will_id on beneficiary(will_id);
create index idx_executor_will_id on executor(will_id);
create index idx_guardian_will_id on guardian(will_id);
create index idx_distribution_instruction_will_id on distribution_instruction(will_id);
create index idx_execution_event_will_id on execution_event(will_id);
create index idx_ai_artifact_will_id on ai_artifact(will_id);
create index idx_audit_log_entity on audit_log(entity_table, entity_id);
create index idx_estate_copilot_message_will_id on estate_copilot_message(will_id);
create index idx_estate_scenario_simulation_will_id on estate_scenario_simulation(will_id);
create index idx_estate_follow_up_question_will_id on estate_follow_up_question(will_id);
create index idx_collaboration_message_will_id on collaboration_message(will_id);
create index idx_execution_checklist_item_will_id on execution_checklist_item(will_id);
create index idx_execution_room_will_id on execution_room(will_id);
create index idx_execution_recording_will_id on execution_recording(will_id);
create index idx_digital_asset_instruction_family_id on digital_asset_instruction(family_id);
create index idx_estate_review_event_family_id on estate_review_event(family_id);
create index idx_post_death_executor_workflow_will_id on post_death_executor_workflow(will_id);

create trigger set_app_user_updated_at before update on app_user for each row execute function set_updated_at();
create trigger set_family_updated_at before update on family for each row execute function set_updated_at();
create trigger set_family_member_updated_at before update on family_member for each row execute function set_updated_at();
create trigger set_questionnaire_submission_updated_at before update on questionnaire_submission for each row execute function set_updated_at();
create trigger set_asset_updated_at before update on asset for each row execute function set_updated_at();
create trigger set_asset_ownership_updated_at before update on asset_ownership for each row execute function set_updated_at();
create trigger set_liability_updated_at before update on liability for each row execute function set_updated_at();
create trigger set_insurance_policy_updated_at before update on insurance_policy for each row execute function set_updated_at();
create trigger set_nomination_updated_at before update on nomination for each row execute function set_updated_at();
create trigger set_will_updated_at before update on will for each row execute function set_updated_at();
create trigger set_document_updated_at before update on document for each row execute function set_updated_at();
create trigger set_beneficiary_updated_at before update on beneficiary for each row execute function set_updated_at();
create trigger set_executor_updated_at before update on executor for each row execute function set_updated_at();
create trigger set_guardian_updated_at before update on guardian for each row execute function set_updated_at();
create trigger set_distribution_instruction_updated_at before update on distribution_instruction for each row execute function set_updated_at();
create trigger set_execution_event_updated_at before update on execution_event for each row execute function set_updated_at();
create trigger set_estate_follow_up_question_updated_at before update on estate_follow_up_question for each row execute function set_updated_at();
create trigger set_collaboration_message_updated_at before update on collaboration_message for each row execute function set_updated_at();
create trigger set_execution_checklist_item_updated_at before update on execution_checklist_item for each row execute function set_updated_at();
create trigger set_execution_room_updated_at before update on execution_room for each row execute function set_updated_at();
create trigger set_digital_asset_instruction_updated_at before update on digital_asset_instruction for each row execute function set_updated_at();
create trigger set_estate_review_event_updated_at before update on estate_review_event for each row execute function set_updated_at();
create trigger set_post_death_executor_workflow_updated_at before update on post_death_executor_workflow for each row execute function set_updated_at();

create trigger immutable_questionnaire_answer_version before update or delete on questionnaire_answer_version for each row execute function prevent_history_mutation();
create trigger immutable_asset_version before update or delete on asset_version for each row execute function prevent_history_mutation();
create trigger immutable_liability_version before update or delete on liability_version for each row execute function prevent_history_mutation();
create trigger immutable_insurance_policy_version before update or delete on insurance_policy_version for each row execute function prevent_history_mutation();
create trigger immutable_nomination_version before update or delete on nomination_version for each row execute function prevent_history_mutation();
create trigger immutable_will_version before update or delete on will_version for each row execute function prevent_history_mutation();
create trigger immutable_document_version before update or delete on document_version for each row execute function prevent_history_mutation();
create trigger immutable_distribution_instruction_version before update or delete on distribution_instruction_version for each row execute function prevent_history_mutation();
create trigger immutable_execution_event_version before update or delete on execution_event_version for each row execute function prevent_history_mutation();
create trigger immutable_ai_artifact before update or delete on ai_artifact for each row execute function prevent_history_mutation();
create trigger immutable_audit_log before update or delete on audit_log for each row execute function prevent_history_mutation();
create trigger immutable_estate_copilot_message before update or delete on estate_copilot_message for each row execute function prevent_history_mutation();
create trigger immutable_estate_scenario_simulation before update or delete on estate_scenario_simulation for each row execute function prevent_history_mutation();
create trigger immutable_execution_recording before update or delete on execution_recording for each row execute function prevent_history_mutation();

-- P4 platform layer (tasks 35-37, 39-40).

create table if not exists jurisdiction_rule (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  aliases text[] not null default '{}',
  registration text not null check (registration in ('optional', 'mandatory')),
  witnesses_required smallint not null default 2,
  video_recording text not null default 'optional' check (video_recording in ('optional', 'recommended')),
  stamp_duty_note text not null default '',
  registration_note text not null default '',
  additional_checklist jsonb not null default '[]',
  effective_from date not null,
  version text not null,
  created_at timestamptz not null default now()
);

create table if not exists legal_knowledge_source (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  title text not null,
  citation text not null,
  keywords text[] not null default '{}',
  content text not null,
  version text not null,
  created_at timestamptz not null default now()
);

create table if not exists execution_video_analysis (
  id uuid primary key default gen_random_uuid(),
  execution_recording_id uuid references execution_recording(id) on delete set null,
  file_name text not null,
  signing_detected boolean,
  witnesses_present boolean,
  will_reading_detected boolean,
  participant_notes text not null default '',
  timeline_notes text not null default '',
  raw_summary text not null default '',
  status text not null default 'pending_review' check (status in ('pending_review', 'reviewed')),
  created_at timestamptz not null default now()
);

create table if not exists gap_analysis_report (
  id uuid primary key default gen_random_uuid(),
  will_id uuid references will(id) on delete cascade,
  readiness_percent smallint not null default 0,
  gaps jsonb not null default '[]',
  strengths jsonb not null default '[]',
  created_at timestamptz not null default now()
);
