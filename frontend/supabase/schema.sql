-- Content Ops schema — DESIGN.md §6 ("Data Model") and FRONTEND-SPEC.md's
-- "Data model additions" / "RLS policy shape", made concrete as runnable
-- SQL. Run this once, in order, against a fresh Supabase project (SQL
-- Editor -> New query -> paste -> Run), before setting
-- NEXT_PUBLIC_USE_MOCK_DATA=false. src/lib/data.ts and
-- src/lib/supabase/webhooks.ts assume every table and column name below
-- exists exactly as written — they're written directly against this file.
--
-- Auth is wired up (2026-09-17 — see DESIGN.md's decisions log): profiles.id
-- is a foreign key to auth.users(id), not a freestanding uuid, so
-- auth.uid() genuinely resolves to a profiles.id and the RLS SELECT
-- policies below are live, not aspirational. There's no public signup —
-- every account is created by an existing admin, through the app's
-- /admin/users page, which calls Supabase's Admin API
-- (auth.admin.inviteUserByEmail) to create the auth.users row and then
-- inserts the matching profiles row itself in the same request. That means
-- profiles never gets a default id generator: it's always supplied
-- explicitly, equal to the auth user it was just created for.
--
-- Real-mode reads split across two different Supabase clients on purpose —
-- see src/lib/data.ts's module comment: listRequests()/getRequestDetail()
-- use a session-bound client so these RLS policies actually filter what
-- comes back; getProfile()/listProfiles() use the service-role client,
-- since profiles has no RLS at all (by design — see the note at the bottom
-- of this file). Writes still always go through the service-role client
-- (src/lib/supabase/webhooks.ts) — that half of the trust boundary hasn't
-- changed.
--
-- Bootstrapping the very first admin: /admin/users itself requires an
-- existing admin to add anyone, which is a chicken-and-egg problem for a
-- brand new project with zero rows. See README.md "Going from mock to
-- real" for the one-time manual step (invite yourself from the Supabase
-- dashboard's Auth UI, then insert your own profiles row with
-- roles including 'admin').

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- pgvector, for source_chunks.embedding

-- ============================================================
-- profiles
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  roles text[] not null default '{}',  -- any of: content_manager, reviewer, admin
  created_at timestamptz not null default now()
);

-- `set search_path = ''` + fully-schema-qualified names is Supabase's
-- current hardening guidance for every function referenced from an RLS
-- policy (prevents a caller from shadowing `profiles`/etc. with an
-- object in a schema earlier on their own search_path). Doesn't change
-- this function's behavior — profiles has no RLS, so is_admin() never
-- needed SECURITY DEFINER — it's just closing a lint warning while this
-- file is already being touched for the fix below.
create or replace function is_admin(p_profile_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = p_profile_id and 'admin' = any(roles)
  );
$$;

-- ============================================================
-- requests
-- ============================================================
create table requests (
  id uuid primary key default gen_random_uuid(),
  idea_or_topic text not null,
  target_audience text not null,
  source_url text,
  tone text not null default 'professional',
  priority_channels text[] not null default '{}',  -- any of: linkedin, x, newsletter

  -- Publish timing is decided at APPROVAL, not at intake (moved
  -- 2026-09-17 — see DESIGN.md Decisions Log). Nullable and left null at
  -- intake for exactly that reason: there's nothing real to store before a
  -- reviewer decides it. handleReviewActionWebhook's approve path is the
  -- only place that ever sets these to a non-null value (fixed 2026-09-18
  -- — this column used to default to 'immediately' at intake, which made
  -- every unreviewed request look already decided).
  publish_timing text
    check (publish_timing in ('immediately', 'scheduled')),
  scheduled_for timestamptz,

  -- Planning's two title/angle options, kept so a reviewer can switch
  -- between them (ContentAngleSelector) instead of the pipeline's own
  -- heuristic being the only say (PRD: "...or select content").
  title_options text[],              -- exactly 2 entries once Planning has run, else null
  chosen_title_index smallint check (chosen_title_index in (0, 1)),
  title_option_reason text,

  -- Additive rubric criteria chosen at intake, on top of the default 9
  -- (assets/content-evaluation-rubric.md) — never a replacement, per
  -- DESIGN.md §13. Shape: [{"name": string, "description": string}, ...],
  -- capped at 5 entries by src/lib/validation.ts. evaluateDraft (mock and
  -- real) scores each one alongside the defaults, tagged scope: "custom".
  custom_rubric_criteria jsonb not null default '[]'::jsonb,

  status text not null default 'intake_complete' check (status in (
    'intake_complete', 'research_failed', 'research_complete', 'drafting',
    'pending_human_review', 'needs_manual_revision', 'rejected_by_human',
    'approved', 'published'
  )),
  failure_reason text,

  submitted_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requests_status_idx on requests(status);
create index requests_submitted_by_idx on requests(submitted_by);

-- ============================================================
-- request_reviewers — replaces an earlier informal "reviewers" field so
-- RLS and assignment queries are straightforward (FRONTEND-SPEC.md)
-- ============================================================
create table request_reviewers (
  request_id uuid not null references requests(id) on delete cascade,
  reviewer_id uuid not null references profiles(id) on delete cascade,
  primary key (request_id, reviewer_id)
);

-- ============================================================
-- request_attachments
-- ============================================================
create table request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  file_type text not null check (file_type in ('txt', 'pdf', 'spreadsheet', 'docx')),
  file_name text not null,
  storage_path text,  -- Supabase Storage object path, once uploaded
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'corrupt', 'removed')),
  uploaded_at timestamptz not null default now(),
  removed_at timestamptz
);

create index request_attachments_request_id_idx on request_attachments(request_id);

-- ============================================================
-- sources + source_chunks — Research & Retrieval / Source Curation
-- (CONTENT-PIPELINE-SPEC.md §1-2)
-- ============================================================
create table sources (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  url text not null,
  title text not null,
  raw_text text,  -- full scraped text, kept for re-chunking/audit even if not shown in the UI
  retrieved_at timestamptz not null default now(),
  selected boolean not null default false,
  relevance_note text  -- always set, kept/rejected — "why" is always answerable
);

create index sources_request_id_idx on sources(request_id);

create table source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  -- 512 dims matches voyage-3-lite's default output. If VOYAGE_EMBEDDING_MODEL
  -- is changed to voyage-3 (1024 dims) or another model, alter this column
  -- (and drop/rebuild the index below) to match before generating embeddings.
  embedding vector(512),
  created_at timestamptz not null default now()
);

create index source_chunks_source_id_idx on source_chunks(source_id);
-- ivfflat needs at least a few thousand rows to be worth it; fine to leave
-- this off entirely for a small project and add it later if retrieval gets
-- slow. lists=100 is a reasonable default for a low-tens-of-thousands scale.
create index source_chunks_embedding_idx on source_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- drafts + evaluations
-- ============================================================
create table drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  version int not null,               -- always incrementing per request, never overwritten
  option_label text not null default 'A',
  title text not null,
  sections jsonb not null,            -- DraftSection[]: [{heading, body, cited_source_ids}]
  generated_by text not null
    check (generated_by in ('system_initial', 'system_revision', 'human_requested', 'human_edited')),
  created_at timestamptz not null default now(),
  -- Bumped on every manual section edit to a `human_edited` draft
  -- (2026-09-18 fix) — repeated manual edits update this SAME row in place
  -- rather than inserting a new version per save, so this is what actually
  -- moves; created_at stays fixed at whenever the version was first
  -- produced. Equal to created_at until the first edit.
  updated_at timestamptz not null default now(),
  unique (request_id, version)
);

create index drafts_request_id_idx on drafts(request_id);

-- The draft actually driving review right now — decoupled from "highest
-- version number" (2026-09-18 fix, DESIGN.md decisions log). A reviewer
-- switching back to a previously-generated angle just repoints this at
-- that draft's id with no new draft row and no AI call; it can therefore
-- point at an older version than the request's most recent draft. Added
-- after `drafts` (rather than inline on `requests` above) purely because
-- it references drafts(id) and drafts didn't exist yet at that point in
-- this file. `on delete set null` rather than cascade: a request should
-- never be deleted just because its active draft's row is (drafts cascade
-- from requests, not the other way around).
alter table requests add column chosen_draft_id uuid references drafts(id) on delete set null;

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  round int not null,
  status text not null check (status in ('pass', 'revise', 'reject')),
  scores jsonb not null,                              -- RubricScore[]
  unsupported_claims text[] not null default '{}',
  sections_needing_revision text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index evaluations_draft_id_idx on evaluations(draft_id);

-- ============================================================
-- rubric_criteria — custom rubric extensibility (DESIGN.md §13)
-- ============================================================
create table rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  scope text not null default 'custom' check (scope in ('default', 'custom')),
  applies_to_channel text,           -- null = all channels
  applies_to_content_type text,      -- null = all content types
  weight numeric not null default 1,
  created_by uuid references profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- channel_assets + publishing_queue
-- ============================================================
create table channel_assets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  draft_id uuid not null references drafts(id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'x', 'newsletter')),
  content text not null,
  status text not null default 'draft'
    check (status in ('draft', 'ready_to_publish', 'published', 'failed')),
  created_at timestamptz not null default now()
);

create index channel_assets_request_id_idx on channel_assets(request_id);

create table publishing_queue (
  id uuid primary key default gen_random_uuid(),
  channel_asset_id uuid not null references channel_assets(id) on delete cascade,
  status text not null default 'ready_to_publish'
    check (status in ('ready_to_publish', 'processing', 'published', 'failed', 'stale_needs_review')),
  scheduled_for timestamptz,   -- null = publish ASAP, once due
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

-- Matches n8n-publish-workflow.json's "Claim Due Posts" query exactly:
-- WHERE status = 'ready_to_publish' AND (scheduled_for IS NULL OR scheduled_for <= NOW())
create index publishing_queue_status_idx on publishing_queue(status);
create index publishing_queue_due_idx on publishing_queue(scheduled_for);

-- ============================================================
-- review_decisions — the UNIQUE constraint IS the multi-reviewer race
-- guard (DESIGN.md §7 / FRONTEND-SPEC.md): two reviewers' inserts for the
-- same draft can't both succeed, full stop, regardless of timing.
-- ============================================================
create table review_decisions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade unique,
  action text not null check (action in ('approve', 'reject', 'request_changes')),
  reviewer_id uuid not null references profiles(id),
  notes text,
  decided_at timestamptz not null default now()
);

-- ============================================================
-- activity_log (human-facing timeline) + stage_logs (machine-facing debug)
-- ============================================================
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  actor_type text not null check (actor_type in ('system', 'human')),
  actor_id uuid references profiles(id),   -- null for system-authored entries
  actor_name text not null,                -- denormalized for display, same as mock mode
  action text not null,
  target text,
  notes text,
  created_at timestamptz not null default now()
);

create index activity_log_request_id_idx on activity_log(request_id);

-- Machine-facing debug telemetry (as opposed to activity_log's human-facing
-- timeline) — not shown anywhere in the UI. First real use (2026-09-18):
-- src/lib/supabase/webhooks.ts's logScrapeFailures records why a research
-- candidate URL didn't become a source (stage: 'research_scrape', status:
-- one of ScrapeFailureReason — 'unsupported_site' | 'http_error' |
-- 'network_error'), so how often the ideal source is a platform Firecrawl
-- won't scrape at all can be measured from real usage instead of guessed.
create table stage_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  stage text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index stage_logs_request_id_idx on stage_logs(request_id);

-- ============================================================
-- Row Level Security — "RLS policy shape" from FRONTEND-SPEC.md.
-- Every write in this app goes through a trusted Next.js server route
-- using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS by design — see that
-- doc's "No table above is directly writable by the browser's Supabase
-- session"). These SELECT policies are what actually scope a logged-in
-- session's reads now that Auth is wired up (src/lib/supabase/routeClient.ts)
-- — a submitter sees their own requests, a reviewer sees what they're
-- assigned to, and is_admin() sees everything.
-- ============================================================
alter table requests enable row level security;
alter table request_reviewers enable row level security;
alter table request_attachments enable row level security;
alter table sources enable row level security;
alter table source_chunks enable row level security;
alter table drafts enable row level security;
alter table evaluations enable row level security;
alter table channel_assets enable row level security;
alter table publishing_queue enable row level security;
alter table review_decisions enable row level security;
alter table activity_log enable row level security;
alter table stage_logs enable row level security;

-- 2026-09-18 fix: requests_select and request_reviewers_select used to
-- check "is this person a reviewer/submitter" by subquerying each OTHER
-- table directly. Since both tables have RLS enabled, evaluating either
-- policy re-triggers the other's policy, which re-triggers the first
-- again — Postgres error 42P17, "infinite recursion detected in policy
-- for relation requests" (hit for real on first live sign-in after the
-- Supabase project was created; see DESIGN.md's decisions log).
--
-- Fix: route the cross-table check through a SECURITY DEFINER function
-- instead of a raw subquery. A SECURITY DEFINER function runs as its
-- owner (the table owner, which bypasses RLS by default), so the query
-- INSIDE the function doesn't re-trigger the other table's SELECT policy
-- — breaking the cycle. `set search_path = ''` + schema-qualified names
-- is required hardening for any SECURITY DEFINER function (see is_admin's
-- comment above for why).
create or replace function is_request_reviewer(p_request_id uuid, p_profile_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.request_reviewers
    where request_id = p_request_id and reviewer_id = p_profile_id
  );
$$;

create or replace function is_request_submitter(p_request_id uuid, p_profile_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests
    where id = p_request_id and submitted_by = p_profile_id
  );
$$;

create policy "requests_select" on requests for select using (
  submitted_by = auth.uid()
  or is_request_reviewer(requests.id, auth.uid())
  or is_admin(auth.uid())
);

create policy "request_reviewers_select" on request_reviewers for select using (
  reviewer_id = auth.uid()
  or is_request_submitter(request_reviewers.request_id, auth.uid())
  or is_admin(auth.uid())
);

create policy "request_attachments_select" on request_attachments for select using (
  exists (
    select 1 from requests r
    where r.id = request_attachments.request_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "sources_select" on sources for select using (
  exists (
    select 1 from requests r
    where r.id = sources.request_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "source_chunks_select" on source_chunks for select using (
  exists (
    select 1 from sources s
    join requests r on r.id = s.request_id
    where s.id = source_chunks.source_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "drafts_select" on drafts for select using (
  exists (
    select 1 from requests r
    where r.id = drafts.request_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "evaluations_select" on evaluations for select using (
  exists (
    select 1 from drafts d
    join requests r on r.id = d.request_id
    where d.id = evaluations.draft_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "channel_assets_select" on channel_assets for select using (
  exists (
    select 1 from requests r
    where r.id = channel_assets.request_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "publishing_queue_select" on publishing_queue for select using (
  exists (
    select 1 from channel_assets ca
    join requests r on r.id = ca.request_id
    where ca.id = publishing_queue.channel_asset_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "review_decisions_select" on review_decisions for select using (
  exists (
    select 1 from drafts d
    join requests r on r.id = d.request_id
    where d.id = review_decisions.draft_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

create policy "activity_log_select" on activity_log for select using (
  exists (
    select 1 from requests r
    where r.id = activity_log.request_id
      and (r.submitted_by = auth.uid()
        or exists (select 1 from request_reviewers rr where rr.request_id = r.id and rr.reviewer_id = auth.uid())
        or is_admin(auth.uid()))
  )
);

-- stage_logs is machine-facing debug telemetry, not something a submitter
-- or reviewer has any reason to see (unlike activity_log above) — admin
-- only.
create policy "stage_logs_select" on stage_logs for select using (is_admin(auth.uid()));

-- profiles is intentionally left without RLS enabled: every profile is
-- meant to be listable (the reviewer picker on the new-request form needs
-- to see everyone with the "reviewer" role) and profiles carry no
-- sensitive fields beyond name/email, mirroring how the mock's
-- listProfiles() already returns every seeded profile unfiltered.
