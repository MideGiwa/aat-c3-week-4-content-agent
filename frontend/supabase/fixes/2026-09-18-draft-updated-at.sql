-- One-off corrective fix for a LIVE Supabase project that already ran the
-- original schema.sql, before drafts.updated_at existed.
--
-- Context: manual section edits (the "inline edit, but versioned" feature)
-- used to create a brand-new draft version on every single save — a
-- reviewer making 50 small wording tweaks produced 50 draft rows. Reworked
-- 2026-09-18 so only the FIRST manual edit to an AI-authored draft creates
-- a new `human_edited` version; every edit after that updates that SAME
-- draft row in place instead. That means `created_at` (whenever the version
-- was first produced) and "whenever it was last actually edited" are no
-- longer the same moment, so a separate `updated_at` column is needed for
-- the UI to show "last edited" accurately. See DESIGN.md decisions log,
-- 2026-09-18, and Draft.updated_at's doc comment in src/lib/types.ts.
--
-- This does exactly what the updated supabase/schema.sql now does for a
-- FRESH project. Safe to run more than once.

alter table drafts add column if not exists updated_at timestamptz not null default now();

-- Backfill: every existing draft's updated_at becomes its created_at.
-- Adding the column above fills existing rows with `now()` (the default),
-- which would make every pre-existing draft look like it was just edited —
-- nothing has actually "been edited since creation" for rows that predate
-- this column, so created_at is the more accurate value. Safe to rerun:
-- harmless no-op once every row's updated_at already equals its created_at.
update drafts set updated_at = created_at;
