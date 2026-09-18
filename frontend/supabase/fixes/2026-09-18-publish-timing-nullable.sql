-- One-off corrective fix for a LIVE Supabase project that already ran the
-- original schema.sql, before publish_timing was made nullable.
--
-- Bug: requests.publish_timing defaulted to 'immediately' at INTAKE, before
-- any reviewer had approved anything — so every unreviewed request already
-- looked like its publish timing had been decided, when nothing had. Only
-- handleReviewActionWebhook's "approve" action is supposed to ever set
-- this column; intake should leave it null until that happens.
--
-- This does exactly what the updated supabase/schema.sql now does for a
-- FRESH project. Safe to run more than once.

alter table requests alter column publish_timing drop default;
alter table requests alter column publish_timing drop not null;

-- Optional cleanup: backfill existing requests that haven't been approved
-- yet (still carrying the old meaningless 'immediately' default) back to
-- null, so the "Publish timing" field on their detail page stops claiming
-- a decision nobody's made. Only touches requests that were never
-- approved/published — approved and published requests keep whatever
-- publish_timing a reviewer actually chose.
update requests
set publish_timing = null, scheduled_for = null
where status not in ('approved', 'published');
