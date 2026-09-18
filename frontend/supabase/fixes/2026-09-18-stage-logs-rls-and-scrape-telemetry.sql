-- One-off fix for a LIVE Supabase project: brings stage_logs up to date
-- with the updated supabase/schema.sql (2026-09-18) — creates the table if
-- an earlier version of schema.sql didn't include it yet, and adds RLS
-- either way (it previously had none, unlike every other table here).
--
-- What this table is for as of today: src/lib/supabase/webhooks.ts's
-- logScrapeFailures now writes a row here every time a research candidate
-- URL doesn't become a source — stage='research_scrape', status is one of
-- 'unsupported_site' (Firecrawl's own "we do not support this site"
-- refusal, or a domain pre-filtered because it's already known to refuse),
-- 'http_error', or 'network_error'. Query it to see how often the ideal
-- source for a request turns out to be a platform Firecrawl won't scrape
-- at all — the actual data this project needs before deciding whether a
-- fallback scraper, an official API, or proxies are worth the added cost
-- and (for the latter) the ToS risk of deliberately bypassing a platform's
-- own anti-scraping policy.
--
-- Safe to run more than once.

create table if not exists stage_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  stage text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists stage_logs_request_id_idx on stage_logs(request_id);

alter table stage_logs enable row level security;

drop policy if exists "stage_logs_select" on stage_logs;
create policy "stage_logs_select" on stage_logs for select using (is_admin(auth.uid()));

-- Example query once some data has come in — how often each failure
-- reason shows up, most common first:
--
-- select status, count(*) from stage_logs
-- where stage = 'research_scrape'
-- group by status
-- order by count(*) desc;
--
-- And which specific domains are being refused, to decide whether the
-- KNOWN_UNSUPPORTED_DOMAINS list in generate.real.ts needs another entry:
--
-- select error_message, count(*) from stage_logs
-- where stage = 'research_scrape' and status = 'unsupported_site'
-- group by error_message
-- order by count(*) desc;
