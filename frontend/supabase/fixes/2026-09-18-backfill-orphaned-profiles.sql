-- Diagnoses and fixes the "submitted_by has no matching profiles row" issue
-- confirmed live on 2026-09-18: a freshly-submitted request's
-- getRequestDetail() lookup for its submitter turned up nothing, even
-- though schema.sql defines requests.submitted_by as
--   uuid not null references profiles(id)
-- — a NOT NULL + foreign-key column. If that constraint were actually
-- enforced, an insert naming a submitted_by with no matching profiles row
-- could never have succeeded in the first place. Seeing it happen live
-- means one of two things is true for this project:
--
--   (a) auth.users has a row (someone can sign in / hold a session as
--       that id) with no matching public.profiles row — most likely a
--       leftover from the self-signup bug closed on 2026-09-18 (DESIGN.md
--       decisions log): an account created via the shouldCreateUser
--       bypass before it was patched, that got signed into and used
--       afterward without ever going through /admin/users. There's no
--       FK violation here because the FK is requests.submitted_by ->
--       profiles.id, not auth.users.id -> profiles.id — nothing stops an
--       orphaned auth.users row from being used as a session's identity.
--   (b) this live project's requests table doesn't actually have the
--       `not null references profiles(id)` constraint schema.sql
--       currently specifies (e.g. it was created from an earlier version
--       of that file, before the constraint was added, similar to the
--       2026-09-18 RLS-recursion fix needed for the same reason).
--
-- Run each numbered query in order. Steps 1-2 are read-only — look at
-- their results before running the fix in step 3.

-- 1. Does this project's live schema even have the constraint schema.sql
--    expects? If this returns no rows, that confirms cause (b) above.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.requests'::regclass
  and conname like '%submitted_by%';

-- 2. Every auth.users row with no matching profiles row — i.e. every
--    account that can sign in but that /admin/users never (or no longer)
--    knows about. Empty result = cause (b), not (a); otherwise this is
--    your list of accounts to fix in step 3.
select u.id, u.email, u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
order by u.created_at;

-- 3. For each orphaned id step 2 returned, insert the missing profiles
--    row so it matches what /admin/users would have created — reusing
--    the auth.users row's own id and email (required: profiles.id is a
--    foreign key straight to auth.users.id) and a real display name in
--    place of the placeholder below. Defaults to the content_manager
--    role; add 'admin' too if this should be an administrator account.
--    Repeat this insert once per orphaned id from step 2.
--
-- insert into public.profiles (id, name, email, roles)
-- values (
--   '<id from step 2>',
--   '<the person''s actual name>',
--   '<email from step 2>',
--   array['content_manager']
-- );

-- 4. Only if step 1 came back empty (cause (b)): bring this live project's
--    schema in line with schema.sql so this can't happen again — every
--    orphaned id must already be backfilled via step 3 first, or this
--    will fail with a foreign-key violation on whichever request row(s)
--    still point at a missing profile.
-- alter table public.requests
--   alter column submitted_by set not null,
--   add constraint requests_submitted_by_fkey foreign key (submitted_by) references public.profiles(id);
