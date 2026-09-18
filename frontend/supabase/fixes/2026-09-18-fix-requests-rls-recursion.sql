-- One-off corrective fix for a LIVE Supabase project that already ran the
-- original (buggy) schema.sql, before the 2026-09-18 RLS-recursion fix.
--
-- Symptom: signing in and loading /board throws
--   code: '42P17', message: 'infinite recursion detected in policy for
--   relation "requests"'
-- Cause: requests_select and request_reviewers_select each subqueried the
-- OTHER table directly. Both tables have RLS enabled, so evaluating either
-- policy re-triggered the other's policy, which re-triggered the first
-- again, forever.
--
-- This does exactly what the updated supabase/schema.sql now does for a
-- FRESH project, plus the "drop policy if exists" lines a fresh project
-- doesn't need (CREATE POLICY isn't idempotent, so re-running the plain
-- create-policy statements against a database that already has these
-- policies would fail with "policy already exists").
--
-- Safe to run more than once. Paste this whole file into your Supabase
-- project's SQL Editor and run it.

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

drop policy if exists "requests_select" on requests;
create policy "requests_select" on requests for select using (
  submitted_by = auth.uid()
  or is_request_reviewer(requests.id, auth.uid())
  or is_admin(auth.uid())
);

drop policy if exists "request_reviewers_select" on request_reviewers;
create policy "request_reviewers_select" on request_reviewers for select using (
  reviewer_id = auth.uid()
  or is_request_submitter(request_reviewers.request_id, auth.uid())
  or is_admin(auth.uid())
);

-- While this file is open: is_admin() itself picked up the same
-- `set search_path = ''` hardening in schema.sql (it never had the
-- recursion bug — profiles has no RLS — this just closes a lint warning).
-- Re-applying it here too so a live project matches schema.sql exactly.
create or replace function is_admin(p_profile_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = p_profile_id and 'admin' = any(roles)
  );
$$;
