-- One-off corrective fix for a LIVE Supabase project that already ran the
-- original schema.sql, before chosen_draft_id existed.
--
-- Bug/gap: the pipeline and review UI only ever treated "the draft with the
-- highest version number" as the one actively under review. That broke the
-- moment a reviewer needed to switch back to a previously-generated content
-- angle (ContentAngleSelector's "Use this instead") without regenerating it
-- — there was no way to say "the active draft is v1, even though v3 exists
-- under the other angle." chosen_draft_id is that pointer: it's what
-- ReviewActions/DraftReviewPanel/ChannelAssetsPanel now key off of instead
-- of assuming "latest = active." See DESIGN.md decisions log, 2026-09-18,
-- and ContentRequest.chosen_draft_id's doc comment in src/lib/types.ts.
--
-- This does exactly what the updated supabase/schema.sql now does for a
-- FRESH project, plus a one-time backfill so existing live rows aren't left
-- with chosen_draft_id = null. Safe to run more than once.

alter table requests add column if not exists chosen_draft_id uuid references drafts(id) on delete set null;

alter table drafts drop constraint if exists drafts_generated_by_check;
alter table drafts add constraint drafts_generated_by_check
  check (generated_by in ('system_initial', 'system_revision', 'human_requested', 'human_edited'));

-- Backfill: every existing request's chosen_draft_id becomes its
-- highest-version draft — exactly the "latest = active" assumption the app
-- used before this fix, so nothing changes for any request that hasn't yet
-- had a reviewer switch angles. Only future angle-switches/manual edits
-- will make chosen_draft_id diverge from "highest version."
update requests r
set chosen_draft_id = latest.id
from (
  select distinct on (request_id) id, request_id
  from drafts
  order by request_id, version desc
) latest
where latest.request_id = r.id
  and r.chosen_draft_id is null;

-- Diagnostic: any request with drafts but still no chosen_draft_id after
-- the backfill (shouldn't happen — flag it if it does).
select id, status, chosen_title_index
from requests
where chosen_draft_id is null
  and id in (select distinct request_id from drafts);
