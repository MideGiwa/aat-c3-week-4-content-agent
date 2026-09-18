-- One-off corrective fix for a LIVE Supabase project that already ran the
-- original (per-owner-scoped) schema.sql, before this change.
--
-- User request: "all content that is in the database should be visible to
-- everyone. not just the owners." Previously, requests_select (and every
-- policy on a table hanging off requests: request_reviewers,
-- request_attachments, sources, source_chunks, drafts, evaluations,
-- channel_assets, publishing_queue, review_decisions, activity_log) only
-- let a request's submitter, its assigned reviewers, or an admin see it.
-- This drops that scoping — any signed-in profile can now see every
-- request and everything attached to it. No app code needed changing:
-- src/lib/data.ts's listRequests()/getRequestDetail() already do a plain
-- select with no submitted_by/reviewer filter of their own (see its
-- comment: "no requests row visible for id=... (not found, or RLS
-- denied)") — the ownership scoping lived entirely in these RLS policies.
--
-- stage_logs is left untouched (still admin-only) — it's internal debug
-- telemetry, not app content, and nothing in this request asked for that
-- to open up too.
--
-- Safe to run more than once. Paste this whole file into your Supabase
-- project's SQL Editor and run it.

drop policy if exists "requests_select" on requests;
create policy "requests_select" on requests for select using (auth.uid() is not null);

drop policy if exists "request_reviewers_select" on request_reviewers;
create policy "request_reviewers_select" on request_reviewers for select using (auth.uid() is not null);

drop policy if exists "request_attachments_select" on request_attachments;
create policy "request_attachments_select" on request_attachments for select using (auth.uid() is not null);

drop policy if exists "sources_select" on sources;
create policy "sources_select" on sources for select using (auth.uid() is not null);

drop policy if exists "source_chunks_select" on source_chunks;
create policy "source_chunks_select" on source_chunks for select using (auth.uid() is not null);

drop policy if exists "drafts_select" on drafts;
create policy "drafts_select" on drafts for select using (auth.uid() is not null);

drop policy if exists "evaluations_select" on evaluations;
create policy "evaluations_select" on evaluations for select using (auth.uid() is not null);

drop policy if exists "channel_assets_select" on channel_assets;
create policy "channel_assets_select" on channel_assets for select using (auth.uid() is not null);

drop policy if exists "publishing_queue_select" on publishing_queue;
create policy "publishing_queue_select" on publishing_queue for select using (auth.uid() is not null);

drop policy if exists "review_decisions_select" on review_decisions;
create policy "review_decisions_select" on review_decisions for select using (auth.uid() is not null);

drop policy if exists "activity_log_select" on activity_log;
create policy "activity_log_select" on activity_log for select using (auth.uid() is not null);
