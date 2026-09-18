# Content Ops Console — front-end scaffold

This is the custom front-end for the AI Content Research & Publishing Agent
(see `../DESIGN.md`, `../FRONTEND-SPEC.md`, and `../CONTENT-PIPELINE-SPEC.md`
for the full system design). It replaces the earlier n8n-forms idea with a
real app so form validation, guardrails, and the human-review flow can all
be handled in one place — and, as of 2026-09-16, the content-generation
pipeline itself (research through channel prep) runs here too, as regular
Next.js server code, instead of a separate n8n workflow calling a standalone
Python service. n8n has no role anywhere in this system anymore — its last
remaining job, the scheduled publish runner, was retired 2026-09-18 (see
`../DESIGN.md` §11); `publishing_queue` itself is the "publish or schedule
for release" deliverable now, and nothing polls or auto-publishes it.

It ships two flows, plus the pipeline that connects them:

- **Submit Request** (`/requests/new`) — the intake form. Submitting one
  runs the full pipeline (research → curation → planning → drafting →
  self-evaluation → revision → channel prep) before the request is even
  created — you land on a request that's already at `pending_human_review`
  with a draft, evaluation history, and per-channel copy ready to look at.
- **Review Dashboard** (`/board`, `/requests/[id]`) — the Kanban board and
  the per-request draft review screen (versions, evaluation, sources,
  channel copy for every priority channel including newsletter, activity
  trail, approve/reject/request-changes).

## Running it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000 — it redirects to `/board`.

No external services are required to run it as-is: it starts in **mock
data mode** (see below), which is the default and is safe to leave on for
demoing or continued front-end work.

Useful scripts:

```bash
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

## Mock data mode

`NEXT_PUBLIC_USE_MOCK_DATA=true` (the default — see `.env.example`) makes
the whole app run against an in-memory store seeded from
`src/lib/mock/seed.ts`, instead of Supabase, Claude, Firecrawl, Tavily, and
Voyage. This exists so the UI, the validation rules, the pipeline, and the
trickier guardrails (see below) can all be exercised and demoed without any
live infrastructure or API keys.

The mock isn't a fake shell around empty screens — it re-implements the
*behavior* that matters, not just the shape of the data:

- **`src/lib/validation.ts`** is the one real copy of the intake validation
  rules (gibberish detection, URL format, file type/size, future-date
  scheduling). It's called from both the client form (instant feedback)
  and the mock webhook handler (the server-side re-check) — so client and
  server can never quietly drift apart here.
- **`src/lib/pipeline/`** (`generate.ts` + `run.ts`) is the actual content
  pipeline — research, curation, planning, drafting, self-evaluation,
  revision, and channel prep — running as deterministic, templated mock
  logic instead of real API calls (see `../CONTENT-PIPELINE-SPEC.md` for
  what each stage does and why). It's wired into intake (every new
  submission runs the full pipeline synchronously) and into review-action
  (approving promotes channel assets to `ready_to_publish`; requesting
  changes triggers an immediate targeted revision).
- **`src/lib/mock/webhooks.ts`** implements the three internal write
  contracts (`content-request`, `review-action`, `manage-attachment`)
  against the mock store, including two guards worth knowing about:
  the multi-reviewer race guard (a second reviewer's decision on an
  already-decided draft is refused with `already_decided`, reproducing what
  a Postgres `UNIQUE` constraint on `review_decisions.draft_id` guarantees
  in the real system) and the stale-draft guard (a decision aimed at a
  draft the pipeline has since superseded with a newer version is refused
  with `stale_draft` — added once automatic revisions made this a real
  possibility, not just a theoretical one).
- Attachments can only be edited/removed while a request is still
  `intake_complete` — once research has consumed them, `manage-attachment`
  refuses with `already_consumed_by_research`, matching DESIGN.md §14.
- The seed data (`src/lib/mock/seed.ts`) deliberately includes one request
  at every pipeline status, a multi-version draft with a revision history,
  a custom (non-default) rubric criterion, per-channel copy (including
  newsletter) at every stage where the pipeline would have generated it,
  and a request that failed research — so every screen state is reachable
  without manually creating test data. New submissions go through the live
  pipeline instead and land wherever it actually takes them.

The mock store is a `globalThis`-backed singleton (`src/lib/mock/store.ts`)
so it survives Next.js dev-mode hot reloads. It resets whenever the dev
server process restarts — there's no persistence across runs, by design.

## Going from mock to real

Real mode is now fully implemented — real Supabase persistence and real
Claude/Firecrawl/Tavily/Voyage AI calls — but **has not been executed against
live infrastructure yet** (no Supabase project has been created, and no live
API calls have been made). Everything below is written and passes
`npm run typecheck` / `npm run build`; it just hasn't been run.

Every read goes through `src/lib/data.ts`, and every write goes through
`src/lib/webhookClient.ts`, which calls either `src/lib/mock/webhooks.ts`
(mock) or `src/lib/supabase/webhooks.ts` (real), branching on
`USE_MOCK_DATA` (`src/lib/config.ts`). The real-mode pieces:

- **`supabase/schema.sql`** — the complete schema (every table, RLS policy,
  and the `review_decisions.draft_id` `UNIQUE` constraint) as runnable SQL.
  Run this once against a fresh Supabase project (SQL Editor → New query →
  paste → Run) before flipping `USE_MOCK_DATA` off.
- **Supabase Auth** — admin-provisioned accounts + passwordless magic-link
  sign-in (no public signup). `src/middleware.ts` gates every route except
  `/login` and `/auth/callback`, redirecting signed-out requests to
  `/login`. `/login` (`LoginForm.tsx`) posts an email to
  `POST /api/auth/request-magic-link`, which looks the email up in
  `profiles` first — no matching row, no email sent, just a 404 with a
  clear message — and only then calls `signInWithOtp`
  (`shouldCreateUser: false`) using the secret-key client for the lookup
  and a plain publishable-key client for the OTP call itself.
  `/auth/callback` exchanges the emailed code for a session.
  `src/lib/supabase/routeClient.ts` (Server Components/Route Handlers, via
  `next/headers`' `cookies()`) and `middleware.ts`'s own inline client (via
  `NextRequest`/`NextResponse` cookies) are two separate `@supabase/ssr`
  client constructions for two different contexts — that's a
  `@supabase/ssr` requirement, not redundancy. Admins provision new users
  at `/admin/users` (`POST /api/admin/users`, which calls the privileged
  `auth.admin.inviteUserByEmail` and inserts the matching `profiles` row) —
  there is deliberately no public signup route. `src/lib/currentUser.ts`
  (`getCurrentProfileId`/`getCurrentProfile`) is what every real-mode read
  and write below uses to find out who's asking, replacing the old
  hardcoded `MOCK_CURRENT_PROFILE_ID` (which mock mode still uses).
- **`src/lib/supabase/server.ts`** — the server-only Supabase client (the
  secret key — Supabase's replacement for the legacy service-role key,
  same full-privilege role, bypasses RLS). Used for system-authored writes
  and for the two reads that intentionally ignore RLS (`getProfile`,
  `listProfiles` — `profiles` has no RLS at all, by design) and for the
  admin-provisioning route. See that file's doc comment.
- **`src/lib/supabase/routeClient.ts`** — the session-bound, RLS-respecting
  client. `listRequests`/`getRequestDetail` use this one, so
  `supabase/schema.sql`'s SELECT policies (submitted_by/reviewer/admin
  scoping) actually take effect per signed-in user, instead of every
  real-mode read bypassing RLS the way it did before Auth existed.
- **`src/lib/data.ts`** — real-mode reads (`listRequests`, `getRequestDetail`
  via the route client above; `getProfile`, `listProfiles` via the
  service-role client) implemented against the schema above.
- **`src/lib/ai/anthropic.ts`, `firecrawl.ts`, `tavily.ts`, `voyage.ts`** —
  thin, dependency-light clients for each API. `anthropic.ts`'s
  `structuredCall()` is what every judgment-call step below uses: it asks
  Claude for JSON matching a shape, validates it, retries once, and throws
  rather than ever silently returning a synthetic pass ("never fail open").
- **`src/lib/pipeline/generate.real.ts`** — the real content pipeline:
  `researchAndCurateSources` (Tavily search + Firecrawl scrape + one Claude
  curation call + Voyage chunk/embed), `planTitleOptions`, `generateDraft`,
  `evaluateDraft`, `reviseDraft`, `prepareChannelAssets` — each documented
  with which spec section and which mock function it's the real
  counterpart to.
- **`src/lib/supabase/webhooks.ts`** — the real-mode orchestrator, mirroring
  `src/lib/mock/webhooks.ts` + `src/lib/pipeline/run.ts` combined: inserts
  the request, runs the pipeline above end-to-end (persisting sources,
  source_chunks, drafts, evaluations, and channel_assets as it goes),
  handles `research_failed` when nothing could be scraped, and implements
  approve/reject/request_changes/select_option — including inserting a
  `publishing_queue` row on approval (what the publish runner actually
  polls) and relying on the real `review_decisions.draft_id` `UNIQUE`
  constraint for the multi-reviewer race guard, instead of the mock's
  find-then-refuse check.

To actually cut over once this is ready to run for real:

1. Create a Supabase project and run `supabase/schema.sql` against it.
2. In the Supabase dashboard: **Authentication → Providers**, confirm
   Email is enabled and password sign-in isn't required (magic link only
   needs "Confirm email" / OTP delivery, not a password). Under
   **Authentication → URL Configuration**:
   - Set **Site URL** to your production origin (the Vercel domain, e.g.
     `https://your-app.vercel.app`) — this is the fallback Supabase uses if
     a request's redirect isn't recognized, so it should be the "real"
     production one, not localhost.
   - Add **both** `http://localhost:3000/auth/callback` (local dev) and
     `https://your-app.vercel.app/auth/callback` (production) to
     **Redirect URLs** — every environment you actually sign in from needs
     its own entry here, or Supabase falls back to the Site URL above
     instead. If you also test from Vercel preview deployments, add a
     wildcard too (`https://*your-project*.vercel.app/**`, adjusted to your
     project's actual preview URL pattern).
   - The app itself never hardcodes a host — `LoginForm.tsx` builds
     `emailRedirectTo` from `window.location.origin` and
     `/api/admin/users/route.ts` builds `redirectTo` from
     `req.nextUrl.origin`, so whichever origin you're actually running on
     (localhost or the Vercel deployment) is used automatically. The
     Redirect URLs allowlist above is what has to be kept in sync by hand;
     the code doesn't need any environment-specific base-URL variable.
   - `NEXT_PUBLIC_SUPABASE_URL` and the two API keys are the same for every
     environment that points at the same Supabase project — set them once
     in Vercel's **Production** environment variables for the deployed app,
     and separately in your local `.env.local` (see step 5). Vercel keeps
     these scoped per environment (Production/Preview/Development)
     automatically; there's nothing extra to wire up beyond filling in each
     one's own `.env`.
3. **Bootstrap the first admin.** `/admin/users` (where new users get
   provisioned) requires an existing admin to reach it, and a fresh
   Supabase project has zero users — so the very first account can't be
   created through the app itself. `/login` won't create this account for
   you either: `POST /api/auth/request-magic-link` looks the email up in
   `profiles` before ever calling `signInWithOtp`, so it 404s for any email
   without a `profiles` row, full stop — no email goes out either way. Create
   the first account by hand, once, per project:
   1. Supabase dashboard → **Authentication → Users → Add user** (or
      `supabase.auth.admin.inviteUserByEmail` from the SQL editor/a script)
      to create the `auth.users` row for that person's email.
   2. Insert a matching row directly in `profiles` (SQL editor):
      `insert into profiles (id, name, email, roles) values ('<the auth.users.id from step 1>', 'Your Name', 'you@example.com', array['admin']);`
   3. From then on, that admin can provision everyone else from
      `/admin/users` — no more manual SQL needed.
   4. If you land on `/board` signed in but see an "Account not set up
      yet" message instead of the console (or the "+ New Request" button
      is missing), that's this exact gap: an `auth.users` row exists for
      your email but step 2's `profiles` insert hasn't been done yet — run
      it for your own account and refresh.
4. Get API keys for Anthropic, Firecrawl, Tavily, and Voyage AI.
5. Copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_USE_MOCK_DATA=false`,
   and fill in every Supabase/Anthropic/Firecrawl/Tavily/Voyage variable
   (the Supabase publishable key is now required too, not just the secret
   key — the browser/route clients use it. Use the current publishable/
   secret keys from Settings -> API Keys, not the legacy anon/service_role
   keys — see `.env.example`'s comment on why).
6. Run `npm run dev`, sign in at `/login` with the bootstrapped admin's
   email (check that inbox for the magic link), then submit a test request
   — the page redirects to it immediately (it stays at `intake_complete`
   briefly), then updates itself as research/drafting/channel-prep run in
   the background (`PipelineProgress.tsx`) and finish at
   `pending_human_review`. This now makes genuinely slow live calls
   (Firecrawl/Tavily/Claude/Voyage in sequence — realistically low tens of
   seconds to a couple of minutes per request); `POST
   /api/webhooks/content-request` doesn't wait for any of it (see
   `export const maxDuration` on that route and its use of `waitUntil` in
   `src/lib/supabase/webhooks.ts`), so it isn't at the mercy of a
   serverless function's default timeout the way it used to be.
7. Optionally set `DISCORD_WEBHOOK_URL` (`.env.example`) to get a Discord
   ping when a request's draft is ready for review, or when the pipeline
   fails — `src/lib/discord.ts`. Leave it blank to skip notifications
   entirely; nothing else depends on it.
8. `publishing_queue` gets a row per approved channel asset
   (`handleReviewActionWebhook`'s approve path) — that row, with whatever
   `scheduled_for` the reviewer picked, is the entire "publish or schedule
   for release" deliverable (`../DESIGN.md` §11). Nothing reads from this
   table automatically; there is no publish runner, n8n or otherwise, in
   this system anymore.
9. Nothing above the data-access/webhook-client/pipeline layer needs to
   change — no component or page imports Supabase, Anthropic, or any other
   API client directly.

## What isn't built yet

Real authentication is now built (see "Supabase Auth" above) — code-complete
and passing `npm run typecheck`/`npm run build`, but not yet executed
against a live Supabase project. Mock mode is unaffected: it still acts as
a single hardcoded profile, `MOCK_CURRENT_PROFILE_ID` in `src/lib/config.ts`,
and `middleware.ts` no-ops entirely while `USE_MOCK_DATA` is true.

Custom rubric criteria can now be added directly from the new-request form
(2026-09-17) — up to 5 per request, additive on top of the default 9,
scored by both the mock and real evaluation pipelines and shown in the
review screen's evaluation panel and request-details sidebar. What's still
not built is a *reusable* rubric-criteria registry (DESIGN.md §13's
original idea of criteria scoped to a channel/content type and reused
across requests, with its own management screen) — today a criterion is
entered fresh for each request, there's no library to pick from or edit
later.

Still carried over from `FRONTEND-SPEC.md` "not built yet": file upload to
Supabase Storage (the form captures a file's name/size for validation but
doesn't upload bytes anywhere in mock mode).
