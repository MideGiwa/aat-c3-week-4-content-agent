# Custom Front-End — Spec

Replaces n8n Form Trigger as the intake mechanism (decision revised 2026-09-16) and doubles as the Human Review UI (`DESIGN.md` §7). One app, two roles of user (submitter and reviewer — the same person can be both), routing every pipeline-state-changing action through its own trusted server layer, and reading Supabase directly for anything that's just display.

**Status (2026-09-16): built.** A runnable scaffold implementing everything below is in `frontend/` — see `frontend/README.md`. UI direction: Card/Kanban board (columns by pipeline stage), neutral palette. It runs against seeded mock data by default (`USE_MOCK_DATA`), with the mock/real split isolated to `src/lib/data.ts` (reads) and `src/lib/webhookClient.ts` (writes) so cutting over to real Supabase doesn't touch any page or component. `npm install && npm run build && npm run typecheck` all pass.

**Revised 2026-09-16 (second pass): the pipeline moved into this app too.** Everything below describing "the request goes to n8n" is superseded — see `CONTENT-PIPELINE-SPEC.md`. `content-request` and `review-action` now call the pipeline module and Supabase directly instead of forwarding to an n8n webhook. n8n's only remaining job at the time, the scheduled publish runner, is itself retired as of 2026-09-18 (`DESIGN.md` §11) — n8n has no role anywhere in this system anymore. The `webhookClient.ts` naming and the request/response JSON shapes below are kept as-is deliberately — they're still the right internal contract between the browser-facing API routes and the server-side handlers, they just don't cross an HTTP boundary to a different service anymore.

## Why a custom front-end instead of n8n Form Trigger

n8n's own reasoning for this switch, restated concretely: a bare form gives you required-field checks and not much else. A real app gets you a date picker that **cannot select a past date** rather than one that can and gets rejected after the fact; instant file-type/size rejection in the browser before an upload even starts; inline, field-specific error messages instead of a generic form failure; and — the bigger reason — it's the same surface that can *also* be the Human Review UI, with a version-history timeline, side-by-side draft options, and live updates when another reviewer acts, none of which an n8n form could ever provide. None of this replaces server-side enforcement — see the "why re-validate" note in `INTAKE-AND-RESEARCH-SPEC.md` §1 — it adds a UX layer on top of it.

## Tech stack

**Next.js (React) + Supabase (Auth, Postgres, Storage, Realtime).** Reasoning: Next.js gives both the client UI and a trusted server-side layer (API routes / server actions) in one app, which matters here — the browser never talks to Supabase with elevated privileges or holds a service-role key directly; only the Next.js server does, and now the same server layer also runs the content pipeline itself (`CONTENT-PIPELINE-SPEC.md`), rather than forwarding to a separate orchestrator. Supabase is already the system of record (`DESIGN.md` §6), so the front-end reads it directly via Row Level Security for anything that's just display. Deployment target: Vercel or any Node host; no separate backend framework or second service needed.

## Architecture

```
Browser (React)
   │  reads (RLS-scoped)              │  writes/actions
   ▼                                  ▼
Supabase (Postgres, Storage,   Next.js server routes
Realtime)               ◀──    (auth-checked, re-validates,
   ▲                            runs the pipeline directly —
   │                            CONTENT-PIPELINE-SPEC.md —
   │                            and writes with the service
   │                            role key)
   └──────────────────────────────────┘
        (content-request, review-action, manage-attachment —
         internal contracts between the browser-facing API
         routes and the server-side handlers; no external
         service or shared secret involved anymore)
```

The browser never talks to anything but this app's own server routes and never holds a service-role key — every action (submit a request, approve, reject, request changes, remove an attachment) goes through a Next.js server route first, which re-checks the requester's session and the payload shape, then calls the pipeline/Supabase directly server-side. Reads (the review queue, a draft's version history, source lists) go straight from the browser to Supabase using the user's own session and RLS.

## Auth & roles

Supabase Auth (magic link or email/password — either works, magic link is less setup). A `profiles` table (new — added to the data model) mirrors `auth.users` with a `roles` array (`content_manager`, `reviewer`, `admin` — not mutually exclusive; the same person can hold more than one).

**Data model additions** (extends `DESIGN.md` §6):
- `profiles` — id (matches `auth.users.id`), name, email, roles (array), created_at
- `request_reviewers` — request_id, reviewer_id (replaces the earlier informal "reviewers" field on `requests` with a proper join table, so RLS and assignment queries are straightforward)
- `review_decisions` — id, draft_id (or channel_asset_id, for a per-channel decision), action (`approve`/`reject`/`request_changes`), reviewer_id, notes, decided_at, **with a UNIQUE constraint on the target (draft_id/channel_asset_id)**

That last table is the concrete fix for the multi-reviewer race condition described in `EDGE-CASES-ADDENDUM.md` §5. Previously that was described as an app-level "first decisive action wins" check — which has its own race window (two requests can both pass a check-then-act read before either writes). A UNIQUE constraint makes it airtight at the database level: two reviewers' `INSERT`s into `review_decisions` for the same draft can't both succeed, full stop, regardless of timing. Whichever insert wins, the loser's insert fails with a Postgres unique-violation (`23505`), and the webhook that attempted it (below) turns that into a `409` response the front-end shows as "already decided by \<reviewer\>."

**RLS policy shape** (policies, not exact SQL — that's an implementation detail for build time):
- `requests`, `drafts`, `evaluations`, `channel_assets`, `activity_log`, `sources`, `source_chunks`, `publishing_queue`: readable by a user if they're the submitter (`requests.submitted_by`) or listed in `request_reviewers` for that request; admins read everything.
- `review_decisions`, `request_reviewers`, `request_attachments`: same scoping.
- **No table above is directly writable by the browser's Supabase session** — every write happens through this app's own Next.js server routes (which use a service-role key, bypassing RLS, since they're the trusted layer). This is deliberate: it keeps "did this go through the actual gates" a property of the write path itself, not something that depends on every RLS policy being airtight against a malicious or buggy client.

## Flow 1: Submit a Request

1. Content manager (role `content_manager` or `admin`) opens **New Request**.
2. Fills the form: idea/topic, audience, optional source URL, optional file upload, tone, priority channels, publish timing (immediate or scheduled — the date/time picker's own UI does not allow selecting a past value), reviewers (defaults pre-filled, editable).
3. Client-side, as the user types/selects: required-field checks, URL format check, file-type/size check *before* the file is even read into memory, so a `.png` is rejected instantly rather than after an upload.
4. On submit: the browser uploads the file (if any) directly to Supabase Storage using a short-lived signed upload URL obtained from a Next.js server route (so storage credentials never reach the browser), then POSTs the form data (with the resulting `storage_path`, not the file itself) to a Next.js server route.
5. The Next.js server route: confirms the caller's session matches `submitted_by`, re-runs the same validation server-side (defense in depth — never trust the browser alone), creates the request, and runs the pipeline directly (`CONTENT-PIPELINE-SPEC.md`) — research through channel prep — before responding.
6. Either returns `200` with a `request_id` (browser redirects to the request's page, which by now shows a draft, evaluation, and channel copy already prepared — or, in real mode, whatever stage a background pipeline job has reached) or `422` with field errors (browser shows them inline, nothing was created).

## Flow 2: Human Review

1. Reviewer (role `reviewer` or `admin`) opens **Review Queue** — a direct Supabase read (RLS-scoped to requests where they're in `request_reviewers`) of everything sitting at `status = 'pending_human_review'`.
2. Opening a request shows, all read directly from Supabase:
   - Every draft version (`drafts`, ordered by `version`) — the version history from `DESIGN.md` §7.
   - The evaluation timeline (`evaluations`, every round's scores and notes).
   - The full activity trail (`activity_log`).
   - The source list (`sources`/`source_chunks`, the ones marked selected).
   - Any channel-adapted previews already generated (`channel_assets`).
3. Reviewer takes an action — **Approve**, **Reject**, **Request Changes** (with a notes field), or **Select** (when more than one draft option exists). This POSTs to a Next.js server route (`POST /api/webhooks/review-action`), which handles it directly:
   ```json
   {
     "request_id": "uuid",
     "draft_id": "uuid",
     "channel_asset_id": "uuid | null",
     "action": "approve | reject | request_changes | select_option",
     "reviewer_id": "uuid",
     "notes": "string | null",
     "selected_option_label": "string | null"
   }
   ```
4. The handler first checks `draft_id` against the request's current latest draft — a decision aimed at a since-superseded draft is refused with `409 { ok: false, reason: "stale_draft", current_draft_id }` (added 2026-09-16 once automatic revisions made a stale `draft_id` a real possibility; `CONTENT-PIPELINE-SPEC.md` §8). Otherwise it attempts `INSERT INTO review_decisions (...)`. If it succeeds: writes `activity_log`, updates `requests`/`drafts`/`channel_assets` status per the action (reject → terminal; request_changes → immediate targeted revision pass, back to `pending_human_review`; approve → this draft's channel assets promoted to `ready_to_publish`), and returns `200 { recorded: true, new_status }`. If the insert hits the unique constraint: returns `409 { recorded: false, reason: "already_decided", decided_by, decided_action }` — **nothing else is written**, so a second reviewer's late action never partially applies.
5. The front-end subscribes to Supabase Realtime on `review_decisions` for the open draft, so if another reviewer decides first, the UI updates live (e.g. the buttons gray out with "Approved by \<name\>") instead of the current reviewer only finding out after clicking and getting a 409.

## Additional webhook: attachment management

`POST /api/webhooks/manage-attachment` — `{ request_id, attachment_id, action: "remove" | "replace", new_storage_path? }`. Enforces the rule from `DESIGN.md` §14: allowed while the request hasn't yet entered Research & Retrieval; past that point, `remove` stops the attachment from being used in any *future* regeneration but does not retroactively strip chunks already embedded from it. Returns `409` if attempted after that point has passed, with a message the front-end surfaces plainly rather than silently no-op'ing.

## Security summary

- Browser holds a Supabase session (RLS-scoped reads) and nothing else — no service-role key, no external service credentials.
- Every write to pipeline state goes through a Next.js server route, which re-validates and then runs the pipeline / writes to Supabase directly with the service role key — never browser → Supabase directly for these tables, and no external orchestrator in the write path anymore.
- The server layer re-validates everything regardless of what the front-end already checked; the front-end's validation is UX, not enforcement.
- The multi-reviewer race is closed with a database constraint, not an app-level check, so it holds even if the front-end has a bug in the "did someone already decide" logic; a stale-draft decision is closed the same way (§8 in `CONTENT-PIPELINE-SPEC.md`).

## Not built yet (flagged, not blockers to starting)

- Exact RLS policy SQL and Supabase Storage bucket/signed-URL configuration.
- The specific component library/design system for the UI (functionally specified here, not visually).
- Notification-on-assignment (a reviewer learning a new request is waiting on them) — could reuse the Discord webhook pattern from the publish runner, or an in-app notification; not decided yet.
