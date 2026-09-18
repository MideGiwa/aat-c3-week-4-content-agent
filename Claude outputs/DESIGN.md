# AI Content Research & Publishing Agent — Design Document

**Project:** Week 4 — AI Content Research and Publishing Agent (Koya Talent)
**Status:** Draft for review — decisions below reflect direction chosen on 2026-09-14
**Author:** Mide Giwa

---

## 1. Business Problem (Simplified)

Koya Talent's content team already has a working pipeline: brainstorm an idea, research it, write an SEO article, adapt it for LinkedIn/X/newsletter, review internally, then publish. The problem isn't quality — it's that every step is manual, so the team can't scale volume without either hiring more people or letting quality, tone, and factual accuracy slip.

The goal is an AI agent that takes over the repetitive middle of that pipeline (research, source selection, drafting, self-checking, channel adaptation) while a human still makes the final call before anything goes out. Two things can't be compromised: the content must stay traceable to real sources, and nothing publishes without human approval.

## 2. Proposed Solution (Overview)

A staged content pipeline, triggered by a content request (idea or URL + audience), that runs research and drafting largely autonomously, self-evaluates its own output against a fixed rubric, revises weak drafts automatically, and then hands off to a human reviewer. Once approved, the system prepares LinkedIn/X/newsletter versions and drops everything into a publishing queue — it does not push directly to the live platforms in this build.

Every step is logged (inputs, outputs, sources used, evaluation scores) so a failure at any stage is easy to trace, and so the final output can show exactly which sources informed it.

### Decisions locked in for this build

- **Orchestration:** Hybrid — n8n handles triggers, stage sequencing, the review/approval interface, and the publishing queue; a small custom service (or n8n Code nodes) handles the heavier LLM calls (planning, drafting, structured-output evaluation) where more control over prompts/parsing is useful.
- **Publishing scope:** Queue-only for this build. Approved content lands in a Supabase table with status `ready_to_publish`, tagged by channel — no live LinkedIn/X/email API integration yet.
- **Retrieval:** Supabase + pgvector. Source excerpts are embedded and stored so sections can be matched to the excerpts that actually support them, and citations stay attached at the excerpt level rather than just "here are 5 links we looked at."

## 3. System Architecture

**Revised 2026-09-16 — see the Decisions Log entry below.** The pipeline (research through channel prep) moved from "n8n orchestrating a standalone Python LLM service" into the same Next.js app as the front-end, running as server-side code. n8n's role is now limited to what it was always uniquely good at here — the scheduled publish runner — not the whole backbone.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Custom Front-End + Pipeline (Next.js, one app)                       │
│                                                                        │
│  Intake ──▶ Research/Retrieval ──▶ Source Curation ──▶ Planning       │
│  (validate,   (Firecrawl scrape      (rank/select        (propose     │
│   never trust  or Tavily/Exa search,  by relevance,        2+ angles, │
│   client input) Supabase + pgvector)  reject the rest)     pick one)  │
│                                                               │       │
│                                                               ▼       │
│                                                    Draft Generation   │
│                                                    (Claude API)       │
│                                                               │       │
│                                                               ▼       │
│                                                    Self-Evaluation    │
│                                                    (rubric, JSON,     │
│                                                     "never fail open")│
│                                                               │       │
│                              revise ◀──── fail ──────┤ pass ──────┐   │
│                          (targeted fix,                              │
│                           re-evaluate,                                │
│                           capped rounds)                              │
│                                                                    ▼  │
│                                                Channel Prep (LinkedIn,│
│                                                X, Newsletter — all    │
│                                                three generated here,  │
│                                                status "draft")        │
│                                                                    │  │
│                                                                    ▼  │
│  Human Review (approve / reject / request changes) ◀─────────────────┘
│      on approval: this request's channel assets → "ready_to_publish"  │
└────────────────────────────────────┬──────────────────────────────────┘
                                      ▼
                        ┌───────────────────────┐
                        │  Publishing Queue       │  Supabase table,
                        │  (Supabase table)       │  status ready_to_
                        └───────────┬─────────────┘  publish, per channel
                                    ▼
                        ┌───────────────────────┐
                        │  n8n Publish Runner     │  Schedule Trigger,
                        │  (unchanged — built)    │  polls every 5 min,
                        │  LinkedIn / X only      │  LinkedIn + X nodes.
                        └───────────────────────┘  Newsletter rows sit at
                                                    ready_to_publish
                                                    indefinitely — generated,
                                                    not yet sent (§11).

Logging: every stage writes to the request's activity log (`activity_log`
table) as it runs, so a failure anywhere is traceable end to end — this
replaces the earlier per-service `runs`/`stage_logs` table concept now that
there's one process instead of several handing off over HTTP.
```

### Component breakdown

- **Custom Front-End + Pipeline (Next.js + Supabase):** one app, doing everything from intake through channel prep, plus serving as the Human Review UI. The browser never talks to anything but this app's own server routes; those routes call the pipeline functions directly and write to Supabase with the service role key — no separate service, no webhook shared secret to manage. See `FRONTEND-SPEC.md` for the UI spec and `CONTENT-PIPELINE-SPEC.md` for the pipeline itself (code structure, request field table, and the reasoning behind this revision).
- **Intake:** collects idea/topic, target audience, optional source URL, optional supporting material as text or an uploaded file (`.txt`, `.pdf`, spreadsheet — `.xlsx`/`.csv`, for numbers/data-heavy input — or `.docx`; anything else is rejected at upload), desired tone, priority channels, and either "publish as soon as approved" or a specific future schedule (past dates/times are rejected both in the front-end's UI and again server-side on receipt — never trusted from the client alone). Attachments can be edited or removed any time before the request has actually started research (see §14).
- **Research/Retrieval:** if a URL is given, Firecrawl scrapes it directly; if it's a raw idea, a search API (e.g. Tavily/Exa, or Firecrawl's search) finds 3–5 candidate reference sources, which are then scraped and chunked.
- **Source Curation:** ranks and selects the chunks/sources that actually matter for this piece and rejects the rest — tracked with a relevance note either way, so "why was this excluded" is always answerable (visible in the review UI's Sources panel, including the rejected ones, collapsed by default).
- **Supabase + pgvector:** chunks are embedded (Voyage AI) and stored with metadata (source URL, title, retrieved_at). Retrieval at drafting time is a similarity search against the request's topic/outline, not just "dump all sources in."
- **Planning → Draft Generation → Self-Evaluation → Revision (Claude API, called directly from Next.js server code):** proposes 2+ angles and picks one; drafts structured sections from the plan + curated sources; scores the draft against the rubric (default 9 criteria plus any custom ones, DESIGN.md §13) with a schema-validated JSON response — a schema failure is a hard error, never silently treated as a pass; and, if the evaluation flags specific sections, revises only those (capped rounds) rather than regenerating from scratch. Full contract in `CONTENT-PIPELINE-SPEC.md`.
- **Channel Prep:** once the draft clears evaluation (or hits the revision cap), generates LinkedIn, X, *and* newsletter versions per each channel's formatting rules — all three, every time a channel is in the request's priority list, not gated on which channels currently have automated publishing. Newsletter *content* has always been in scope; only its *distribution* is still undecided (Decisions Log, §10), and that's a separate concern from whether the copy gets generated and is reviewable.
- **Human Review (the same front-end):** shows every draft version with its full evaluation/revision/activity timeline, the source list, and the per-channel copy; supports **approve** (promotes this request's channel assets to `ready_to_publish`), **reject** (terminal — kills the request), or **request changes** (triggers an immediate targeted revision pass with the reviewer's own notes, then returns to pending review with the new version — `CONTENT-PIPELINE-SPEC.md` §7). More than one reviewer can be assigned to a request; "first decisive action wins" is enforced with a database unique constraint (`review_decisions`, §6); a decision aimed at a draft the pipeline has since superseded is also rejected (`stale_draft`), not silently applied to stale content — see `FRONTEND-SPEC.md` §"Flow 2."
- **Publishing Queue:** a Supabase table the n8n publish runner reads from — satisfies the PRD's "saved into a clear publishing queue" bar. Every priority channel's copy lands here once approved, including newsletter; the runner just doesn't have a node that does anything with newsletter rows yet.

## 4. Tool Stack

| Layer | Tool | Why |
| --- | --- | --- |
| Front-end + Pipeline | Next.js + Supabase (Auth, Storage, Realtime) | One app for intake, the full research→channel-prep pipeline, and review; real client-side validation (a date picker that can't select the past, instant file-type checks) plus a trusted server layer that writes to Supabase directly — no separate service to call over the network — see `FRONTEND-SPEC.md` and `CONTENT-PIPELINE-SPEC.md` |
| Publishing orchestration | n8n | Scheduled publish runner only (polls the queue, posts to LinkedIn/X) — no longer the pipeline's backbone; see the 2026-09-16 Decisions Log entry for why that changed |
| LLM generation & evaluation | Claude API (structured outputs), called directly from Next.js server code | Planning, drafting, rubric-based self-evaluation, revision — structured outputs keep evaluation scores and source citations machine-readable; `CONTENT-PIPELINE-SPEC.md` |
| Scraping | Firecrawl | URL-based extraction for the URL-based request scenario |
| Search | Tavily / Exa (or Firecrawl search) | Finds candidate sources for raw-idea requests with no URL |
| Embeddings | Voyage AI (`voyage-3-lite`/`voyage-3`) | Anthropic doesn't offer a first-party embeddings endpoint; Voyage is Anthropic's recommended embedding partner and pairs cleanly with pgvector |
| Retrieval store | Supabase (Postgres + pgvector) | Embedding storage, similarity search, and the system of record for requests, sources, drafts, evaluations, and the publishing queue |
| Notifications | Discord (incoming webhook) | Alerts a human when something needs attention — failures, stale posts, repeated failures — without needing a bot/OAuth setup |

## 5. Pipeline Stages (detailed)

1. **Intake** — request captured with idea/topic, audience, optional source URL, tone, priority.
2. **Research & Retrieval** — scrape (if URL) or search + scrape (if raw idea); chunk and embed into Supabase.
3. **Source Curation** — LLM ranks/selects the excerpts worth using, discards irrelevant or low-quality material.
4. **Content Planning** — outline with primary/secondary keywords, section structure, and a source-to-section map.
5. **Draft Generation** — 2–3 article options generated per the SEO best practices, each grounded in mapped sources with inline citations. The full source list is always tracked internally (traceability is non-negotiable per the PRD), and — where appropriate per the SEO best practices' link guidance — relevant sources are also surfaced in the article itself, either as inline links at the claims they support or as a closing "Sources"/"Further reading" section, not only kept in an internal-only audit trail.
6. **Self-Evaluation** — Claude scores the draft against the rubric (topic relevance, source grounding, factual consistency, audience fit, tone, SEO fit, channel fit, clarity, completeness) and returns pass/revise/reject plus specific notes.
7. **Revision Loop** — "revise" triggers targeted regeneration of only the flagged sections, then re-evaluation; capped at 2–3 rounds, with every round's scores and notes preserved as history.
8. **Human Review** — reviewer sees the article(s), full evaluation/revision history, and sources; approves, rejects, requests a revision, or selects among options.
9. **Channel Adaptation** — approved article is adapted into LinkedIn, X, and newsletter formats per the formatting rules.
10. **Publishing Queue** — each channel asset is written to the queue table with status `ready_to_publish`, still linked to its source list.
11. **Logging** — every stage writes structured logs (inputs, outputs, errors) keyed by request ID for debugging.

## 6. Data Model (Supabase — initial sketch)

- `profiles` — id (matches Supabase `auth.users.id`), name, email, roles (array: `content_manager`/`reviewer`/`admin`), created_at
- `requests` — id, idea/topic, audience, source_url, tone, status, submitted_by (→ `profiles`), created_at
- `request_reviewers` — request_id, reviewer_id (→ `profiles`) — who's assigned to review a request; replaces an earlier informal "reviewers" field
- `review_decisions` — id, draft_id (or channel_asset_id), action (`approve`/`reject`/`request_changes`), reviewer_id, notes, decided_at — **UNIQUE constraint on the target (draft_id/channel_asset_id)**, so two reviewers can never both successfully record a decision on the same thing; this is what actually enforces "first decisive action wins" (§7), at the database level rather than as an app-level check that itself could race
- `request_attachments` — id, request_id, file_type (`txt`/`pdf`/`spreadsheet`/`docx`), file_url, status (`uploaded`/`processing`/`corrupt`/`removed`), uploaded_at, removed_at
- `sources` — id, request_id, url, title, retrieved_at, raw_text
- `source_chunks` — id, source_id, chunk_text, embedding (pgvector), relevance_notes
- `drafts` — id, request_id, version (int, always incrementing — a regeneration never overwrites, it creates the next version), content, option_label, generated_by (`system_initial`/`system_revision`/`human_requested`), created_at
- `evaluations` — id, draft_id, round, status (pass/revise/reject), scores (jsonb), notes, created_at
- `rubric_criteria` — id, name, description, scope (`default`/`custom`), applies_to_channel (nullable — null means "all channels"), applies_to_content_type (nullable), weight, created_by, active (bool)
- `channel_assets` — id, request_id, draft_id, channel (linkedin/x/newsletter), content, status
- `publishing_queue` — id, channel_asset_id, status (`ready_to_publish` / `processing` / `published` / `failed` / `stale_needs_review`), scheduled_for, published_at, error_message
- `activity_log` — id, request_id, actor_type (`system`/`human`), actor_id, action (e.g. `regenerate_draft`, `approve`, `reject`, `request_changes`, `add_reviewer`, `remove_attachment`), target (e.g. draft id, attachment id), notes, created_at — this is the human-facing timeline; `stage_logs` stays the machine-facing debug log
- `stage_logs` — id, request_id, stage, status, error_message, created_at

## 7. Human Review & Approval

Nothing reaches `publishing_queue` without an explicit approval action recorded against a specific draft/channel-asset.

**Reject vs. Request Changes are two distinct actions, not one "reject" button:**
- **Reject** is terminal. The request ends (`status = rejected_by_human`), the submitter is notified, and nothing further happens automatically — no auto-regeneration. If the idea is worth revisiting, that's a new request.
- **Request Changes** sends the current draft back into the revision loop with the reviewer's notes attached, the same mechanism the automatic rubric-triggered revision uses (see §5, step 7) — just triggered by a human instead of a failing rubric score. It's still capped at the same 2–3 rounds and still preserves every round's history.

**Multiple reviewers:** a request can have more than one assigned reviewer (`request_reviewers`, §6). Default collaboration model — **first decisive action wins**: whichever reviewer approves, rejects, or requests changes first is the recorded decision, enforced by the `review_decisions` table's unique constraint on the target draft/channel-asset (§6) — a database-level guarantee, not just an app-level check, so a second conflicting action can't slip through a race window. It's refused with "already decided by \<reviewer\>" via a `409` response (`FRONTEND-SPEC.md` §"Flow 2"), and the front-end's Supabase Realtime subscription surfaces this live to anyone else looking at the same draft. Any reviewer can leave comments at any time regardless of who has final say, and every action from every reviewer is recorded in `activity_log` for full accountability. **Whether some content should require sign-off from more than one reviewer (e.g. anything client-facing or compliance-sensitive) instead of "first wins" is a genuine policy question** — see `BUSINESS-QUESTIONS.md`.

**Version history, regeneration & activity trail (draft stage, step 4):** yes — a draft can be regenerated at any point, whether triggered automatically (failed rubric check) or manually (a reviewer's "request changes" or an explicit "regenerate" action). Every regeneration writes a *new* row to `drafts` with an incremented `version` — nothing is overwritten in place — so the full version history is always available to page through. Two views are available side by side: the **evaluation timeline** (every round's rubric scores and notes, from `evaluations`) and the **activity trail** (every human and system action — who did what, when — from `activity_log`). Together they answer "how did we get from v1 to the version that got approved."

## 8. Mapping to PRD Test Scenarios

| PRD Scenario | Covered by |
| --- | --- |
| Raw idea request | Search + scrape branch in Research & Retrieval |
| URL-based request | Firecrawl branch in Research & Retrieval |
| Source grounding | pgvector-backed source-to-section mapping, inline citations |
| Evaluation & revision loop | Self-Evaluation + Revision Loop stages, `evaluations` table history |
| Human approval | Human Review stage, gated `publishing_queue` writes |
| Channel formatting | Channel Adaptation stage against formatting rules |
| Publishing/scheduling | `publishing_queue` table (queue-only scope), immediate-or-scheduled with past-date rejection at input |
| Failure handling | `stage_logs` table + n8n execution history, per-request isolation (§15) |
| Corrupt/invalid supporting material | `request_attachments.status = corrupt`, rejected at upload for disallowed file types |
| Draft regeneration & history | `drafts.version` (never overwritten), `evaluations` timeline, `activity_log` trail |
| Multi-reviewer conflicts | "First decisive action wins" constraint on draft/channel-asset decisions |

## 9. Open Questions for Stakeholders

These are the kinds of questions worth confirming with whoever assigned this project (a content lead, program manager, or client) before locking scope further:

- **Volume & cadence** — how many pieces of content per week/month should this handle? Affects whether a simple queue is enough or whether priority/concurrency handling matters.
- **Source credibility bar** — is any public source acceptable, or should research be restricted to a vetted domain list? How should conflicting sources be handled?
- **Number of draft options** — how many article options should the system generate, and should the system pre-select the best one per the rubric before a human ever sees it, or always show all options?
- **Approval workflow** — single reviewer, or a multi-step chain (e.g., content lead then account manager)? Does a rejection require a brand-new request or can it restart the pipeline from planning?
- **Brand voice specifics** — beyond the channel formatting rules doc, is there a fuller style/voice guide, especially if different clients or verticals need different tones?
- **Confidentiality** — any constraint on sending client source material to external APIs (Claude, Firecrawl, search providers)?
- **Cost ceiling** — is there a target cost per article, given multiple draft generations plus evaluation plus revision rounds?
- **Existing systems** — is there a CMS, social scheduler, or email platform this should eventually integrate with, or is the queue the end of scope for now?
- **Success metric** — how will "this worked" be measured after launch (time saved, volume increase, first-pass approval rate, etc.)?

## 10. Decisions Log

| Date | Decision | Chosen |
| --- | --- | --- |
| 2026-09-14 | Orchestration approach | Hybrid (n8n + custom LLM service) |
| 2026-09-14 | Publishing scope | Queue-only (no live platform APIs) |
| 2026-09-14 | Retrieval approach | Supabase + pgvector |
| 2026-09-14 | Publishing scope (revised) | Extended beyond queue-only — added an n8n workflow that polls the queue and publishes automatically |
| 2026-09-14 | Automated publish channels | LinkedIn and X only for now (Medium dropped, newsletter deferred/manual) |
| 2026-09-14 | Publish check interval | Every 5 minutes |
| 2026-09-15 | Newsletter scope | Newsletter *content generation* is in scope (channel adaptation produces it); the distribution mechanism (ESP, ConvertKit, plain email, etc.) is explicitly deferred to technical tool selection |
| 2026-09-15 | Scheduling | Requests can be published immediately or scheduled for a future date/time; past dates/times are rejected at input |
| 2026-09-15 | Supporting material formats | Uploaded attachments limited to `.txt`, `.pdf`, spreadsheet (`.xlsx`/`.csv`), `.docx` — other formats rejected at upload |
| 2026-09-15 | Multi-reviewer default | "First decisive action wins" is the default collaboration model; whether some content needs multi-reviewer consensus is an open business question |
| 2026-09-15 | Rubric extensibility | Rubric criteria beyond the PRD's default 9 can be added, scoped per channel/content type, without modifying the default rubric |
| 2026-09-16 | Notifications | Added a Discord webhook notification service for events needing human attention; scoped as an alert channel (failures/escalations), not a success firehose |
| 2026-09-16 | Custom LLM service architecture | Standalone service (Python/FastAPI/Pydantic), not n8n Code nodes — see `LLM-SERVICE-SPEC.md` |
| 2026-09-16 | Embedding provider | Voyage AI (`voyage-3-lite`/`voyage-3`) for pgvector embeddings |
| 2026-09-16 | Intake mechanism | n8n Form Trigger (native form + file upload) rather than a custom front-end for MVP |
| 2026-09-16 | Build order | Next up: Intake + Research & Retrieval + Source Curation, spec'd in `INTAKE-AND-RESEARCH-SPEC.md`, not yet built as workflow code |
| 2026-09-16 | Intake mechanism (revised) | Replaced n8n Form Trigger with a custom front-end (Next.js + Supabase) that talks to n8n over webhooks — reused as the Human Review UI too, not just intake. See `FRONTEND-SPEC.md`. Supersedes the 2026-09-16 "Intake mechanism" entry above. |
| 2026-09-16 | Multi-reviewer race handling | Moved from an app-level "first wins" check to a database unique constraint (`review_decisions`), closing the check-then-act race window the earlier design still had |
| 2026-09-16 | Front-end scaffold built | Card/Kanban board direction chosen (over a table or a simple list), neutral palette for now, built as a full runnable Next.js scaffold against seeded mock data covering both flows (submit request, review dashboard) rather than a static mockup — see §21 and `frontend/README.md` |
| 2026-09-16 | Pipeline moved into Next.js, off n8n + standalone service | Research, curation, planning, drafting, evaluation, revision, and channel prep all now run as Next.js server code in the same app as the front-end, calling Claude/Firecrawl/Tavily/Voyage directly instead of routing through an n8n workflow into a separate Python/FastAPI service. Reasoning: intake and review had already moved into this app (the 2026-09-16 "Intake mechanism (revised)" entry above); keeping the generation stages on the far side of an HTTP hop into a second service added a network boundary, a second deployment target, and a second auth/secret to manage for no benefit once nothing else was consuming that service — n8n's own value here was never "orchestrating Claude calls," it was the scheduler + platform API nodes it already provides for publishing. n8n's role is now exactly that: the publish runner (§11), unchanged. Supersedes §19 and §20; current spec is `CONTENT-PIPELINE-SPEC.md`. Built as real code, not just designed — see §22. |
| 2026-09-16 | Newsletter channel copy always generated | Channel Prep generates LinkedIn, X, and newsletter copy for every request that lists them as a priority channel, regardless of which channels the n8n publish runner currently automates. Newsletter generation was never blocked on distribution being decided — only *sending* it is deferred (§11 "Scope note", Decisions Log's original newsletter entry). Per-channel copy (including newsletter) is now visible in the review UI for every request that has reached channel prep, not only ones already approved. |
| 2026-09-16 | Stale-draft guard added to review-action | While wiring the pipeline's automatic revision rounds, found that `review-action` never checked whether `draft_id` was the request's current draft — a decision aimed at a since-superseded version would still silently move the request to approved/rejected. Fixed with an explicit check (`stale_draft`, HTTP 409), the same "gate, don't guess" pattern as the existing `already_decided` race guard, added once revisions started happening automatically and frequently enough to make a stale draft_id a real, not just theoretical, possibility. |

## 11. Publish Queue Runner (n8n workflow)

Section 2/3 described the publishing queue as the end of scope. That's now extended: a dedicated n8n workflow (`n8n-publish-workflow.json`, setup notes in `PUBLISH-WORKFLOW-SETUP.md`) polls `publishing_queue` every 5 minutes and publishes due items automatically.

**Flow:** Schedule Trigger (5 min) → query `publishing_queue` for rows with `status = 'ready_to_publish'` and `channel IN ('linkedin','x')` where `scheduled_for` is null (publish ASAP) or already due → process one row at a time → route by channel → LinkedIn node / X node → update the row to `published` or `failed` (with the error message) and log the attempt to `stage_logs`.

**Scheduling rule:** `scheduled_for` must be either null (publish as soon as approved/claimed) or a timestamp strictly in the future at the moment it's set — this is validated at the point of scheduling (intake or review UI), not left for the runner to discover a stale date later. Combined with the stale-schedule guard already in the runner (§11 above, hardening pass), this means a scheduled time can never end up in the past by the time it's actually due, whether that's from user error or system downtime.

**Scope note:** Medium and the email newsletter are intentionally not wired into this workflow yet — the queue still stores those rows with `status = 'ready_to_publish'`, but nothing currently picks them up. That's a deliberate scope cut, not an oversight; revisit if/when those channels need automated publishing too.

**Failure handling:** each platform node runs with "continue on error" so one failed post doesn't block the rest of the batch — it's marked `failed` with the API's error message and logged, and stays visible for a human to retry or triage rather than silently disappearing.

**Discord notifications (2026-09-16):** the runner now posts to a Discord webhook whenever something needs a human's attention: a publish failure (per row, with the actual error), a validation failure (content rejected before it ever reached the platform API), a batch of newly-flagged stale posts (one summary message, not one per row), and a repeated-failure escalation (3+ failures on one channel within an hour — this is what actually surfaces a silently-expired credential, closing the gap flagged in the earlier hardening pass). Successful publishes are deliberately **not** pinged by default — see `PUBLISH-WORKFLOW-SETUP.md` §4 for the reasoning (Discord stays an alert channel, not an activity firehose) and how to add success notifications if wanted.

**Hardening pass (2026-09-15):** a review against the PRD's edge cases (full writeup in `EDGE-CASES-AND-GUARDRAILS.md`) found and fixed a real double-publish race condition — the runner now atomically claims rows (`FOR UPDATE SKIP LOCKED`) instead of a plain `SELECT`, so two overlapping executions can never publish the same row twice. It also added a stale-schedule guard (anything more than 24h overdue is pulled into `stale_needs_review` instead of being auto-blasted after downtime) and a validation gate that checks content is non-empty and within each channel's limits *before* any platform API call, marking violations `failed` with a specific reason instead of letting the API reject them opaquely. Credential-expiry alerting and rate-limit-aware retry were identified but not yet built — see the review doc's "known gaps."

## 12. Full Edge Case & Guardrail Review

See `EDGE-CASES-AND-GUARDRAILS.md` for the complete stage-by-stage review: required inputs and failure behavior for every stage from intake through publishing, cross-cutting hardening (treating scraped/model text as untrusted data, schema-validating every LLM structured output, never failing open, cost/iteration caps, dedup), and suggested additions to the PRD's testing evidence table.

A second, more product-focused round of questions (rubric extensibility, draft versioning, supporting-material uploads, multi-reviewer review, reject vs. request-changes, scheduling, cross-request failure isolation, context window handling, timing estimates) is answered in the sections below and logged in full in `EDGE-CASES-ADDENDUM.md`.

## 13. Custom Rubric Criteria (Extensibility)

The PRD's rubric (`assets/content-evaluation-rubric.md`) defines 9 default criteria — Topic Relevance, Source Grounding, Factual Consistency, Audience Fit, Tone, SEO Fit, Channel Fit, Clarity, Completeness. Those always apply, and the default rubric file itself is never edited — it stays the PRD's source of truth.

On top of that, the design now supports **custom criteria that are additive, not a replacement**, stored in `rubric_criteria` (§6) and scoped to a channel and/or content type (e.g. a criterion that only applies to LinkedIn posts, or only to anything tagged "client-facing"). At evaluation time, the evaluation prompt includes the default 9 plus whatever active custom criteria apply to that specific request's channel/content type, and the evaluation's structured output extends to score each one by name — so a custom criterion is scored exactly like a default one, just clearly labeled `scope: custom` in the output so it's obvious in review which criteria are PRD-standard and which were added.

**Suggested custom criteria worth having available out of the box** (all optional/additive, none replace the default 9):
- **Hook Strength** — does the opening line earn a read, especially on LinkedIn (truncates after ~3 lines) and X (no second chance)?
- **Actionability** — does the reader walk away with something concrete to do, not just information?
- **Differentiation** — does it say something not already said identically by the top competing articles found during research, or is it a generic rehash?
- **Data/Stat Accuracy** — for any numeric claim, does it match the source exactly (no rounding drift, no misattributed figure)? Especially relevant when supporting material is a spreadsheet.
- **Citation/Link Validity** — do included links actually resolve and match the claim they're attached to?
- **Brand Safety / Compliance** — flags competitor bashing or unverified legal/medical/financial claims for a human's attention rather than blocking outright.
- **CTA Effectiveness** — is the call-to-action specific and channel-appropriate, not a generic "learn more"?
- **Accessibility & Readability** — reading level appropriate for the stated audience, jargon explained, alt text present if an image is included.

**Open governance question:** who gets to create/edit custom criteria — any content manager, or a content lead only? Flagged in `BUSINESS-QUESTIONS.md` rather than decided here.

## 14. Supporting Material (Text & File Uploads)

Beyond a source URL, a request can include supporting material as pasted text or an uploaded file. Accepted formats: **`.txt`**, **`.pdf`**, a **spreadsheet** (`.xlsx`/`.csv` — for numeric or tabular source data), and **`.docx`**. Anything else is rejected at upload with a clear message listing the accepted types — never silently ignored or passed through.

**Corrupt files:** every upload is parse-tested immediately (can it actually be opened/read as its claimed type?). A file that fails is marked `corrupt` in `request_attachments` and the submitter is asked to re-upload — a corrupt file is never handed to research/drafting as if it were readable.

**Edit/removal:** attachments can be edited or removed by the submitter any time before the request has actually entered the Research & Retrieval stage. Once research has already consumed a file (chunked and embedded it), removing the attachment record stops it from being used in any *future* regeneration but doesn't retroactively strip already-embedded chunks from a draft that already used them — that would silently change grounding underneath a draft someone may already be reviewing. Every add/edit/removal is written to `activity_log`.

**Large files & the context window:** a large PDF or spreadsheet is chunked and embedded exactly like a scraped web source (§ Retrieval), not stuffed into a single prompt whole — see §16.

## 15. Failure Handling & Isolation Across Requests

The PRD is explicit that a failure in one stage shouldn't take down the whole system, and that's a structural property of the design, not just an error-handling afterthought: **every request is processed as an independent unit of work keyed by its own `request_id`**, with its own status and its own row in every table. A failure at any stage — research finding nothing, a malformed LLM response, a publish-destination error — updates *only that request's* status (e.g. `research_failed`) and writes to `stage_logs`; it never throws an exception that could stop the orchestrator from picking up other, unrelated requests. Concretely: the n8n orchestration processes requests as separate items/executions rather than one shared in-memory loop, so one request stuck retrying research doesn't block another request that's ready to move to drafting.

This is the same principle already built into the publish runner (§11): one row failing to post doesn't block the rest of the batch. It just applies end-to-end, not only at the publishing stage.

## 16. AI Context Window Management

Nothing in the pipeline feeds raw, unbounded source text into a single LLM call:

- **Retrieval is top-K, not top-everything.** Scraped/uploaded source text is chunked and embedded (pgvector) once, and any given prompt (planning, drafting, evaluation) only pulls in the chunks relevant to what that call needs — a 50-page source contributes a handful of relevant excerpts to a given section, not its full text.
- **Each stage's prompt only carries what that stage needs.** Evaluation, for example, doesn't need the entire source corpus resent — it needs the draft plus the specific excerpts the draft cited.
- **Structured outputs keep responses compact** — a JSON object with defined fields is naturally bounded, unlike free-form prose.
- **A token budget is set per call, well under the model's actual context limit**, leaving headroom for the system prompt, retrieved context, and the response itself; if a single request would need more than that budget (e.g. an enormous uploaded document), it gets summarized/re-chunked further rather than truncated silently.

## 17. Estimated Timings

Rough, pre-build estimates — to be replaced with real numbers once Firecrawl/search/embedding are actually wired up and benchmarked:

- **Single URL scrape (Firecrawl):** ~2–8 seconds per URL.
- **Search + scrape for a raw idea (3–5 sources):** ~10–30 seconds if done sequentially, ~5–15 seconds if parallelized.
- **Chunking + embedding into Supabase:** a few seconds for a typical article-length source; longer for a large uploaded document.
- **Research & Retrieval stage, end to end:** roughly **15–45 seconds** for a typical request, up to a minute or two in a worst case (slow sites, retries, a large uploaded file).
- This is separate from drafting/evaluation time (the LLM calls), which will add its own latency on top — a full first-draft turnaround (research through a passing evaluation) is likely a small number of minutes rather than seconds, before any human review time.

## 18. Notification Service (Discord)

A cross-cutting service, not tied to one stage: whenever something in the pipeline needs a human's attention, it posts to a Discord channel via an incoming webhook (no bot, no OAuth — see `PUBLISH-WORKFLOW-SETUP.md` for setup). The design intent is that Discord is an **alert channel**, not a log stream — it only speaks up for things that are actionable or worth a human's awareness, mirroring the "gate, don't guess" principle the rest of this doc leans on: quiet by default, loud when something needs a look.

**Built (in `n8n-publish-workflow.json`):**
- Publish failure, per row, with the actual platform error (LinkedIn/X).
- Validation failure — content rejected before it reached a platform API, with the specific reason.
- Stale scheduled posts flagged — one summary message per batch, not one per row.
- Repeated-failure escalation — 3+ failures on one channel within the last hour, the signal that something structural (an expired credential, a persistent rate limit) is wrong rather than one-off bad luck.

**Designed, not yet built** (these stages aren't implemented as actual workflow code yet — §2's earlier stages are still design-only, so there's nothing to wire a notification into yet, but this is where it would hook in once they are):
- `research_failed` — a request found zero usable sources.
- Evaluation escalation — the rubric evaluator's output failed to parse twice in a row (§ "never fail open," `EDGE-CASES-AND-GUARDRAILS.md`).
- Revision cap hit — a draft used all its revision rounds without passing (`needs_manual_revision`).
- A draft is ready for human review (lower priority — arguably a digest rather than a per-item ping, to avoid the same "firehose" problem success notifications would cause on the publish side).
- Corrupt or rejected supporting-material upload.
- Human review actions (approve/reject/request changes) — optional, mainly useful if a team wants visibility into review activity beyond `activity_log` itself.

Each of these, once its stage exists as real workflow code, is just another write to `stage_logs`/`activity_log` with a Discord node attached alongside it — the pattern is already established by what's built.

## 19. Intake, Research & Retrieval, Source Curation — Detailed Spec

**Superseded 2026-09-16.** This section originally described these three stages as n8n's job, spec'd in `INTAKE-AND-RESEARCH-SPEC.md`. Both the framing and the document are superseded — intake, research, curation, and everything through channel prep now live in the Next.js pipeline described in `CONTENT-PIPELINE-SPEC.md`, which is the current spec and is now built as real code (not just designed) in `frontend/src/lib/pipeline/`. `INTAKE-AND-RESEARCH-SPEC.md` is kept for history with a banner pointing here.

## 20. Standalone LLM Service

**Superseded 2026-09-16 — see the Decisions Log.** This section originally called for a standalone Python/FastAPI service, called over HTTP from n8n, to own every Claude API call. That's reversed: planning, drafting, evaluation, and revision are now Claude API calls made directly from the same Next.js server code as the rest of the pipeline — no separate service, no HTTP hop, no second deployment target. The "never fail open" evaluation contract and context-budget reasoning from the original spec still apply exactly as written; only *where the code runs* changed. Current spec: `CONTENT-PIPELINE-SPEC.md`. `LLM-SERVICE-SPEC.md` is kept for history with a banner pointing here.

## 21. Custom Front-End (Intake + Human Review)

Replaces the n8n-Form-Trigger intake plan from earlier in this section — full reasoning, architecture, auth/roles, both flows (submit a request, review a draft), and the webhook-shaped contracts it uses internally (`content-request`, `review-action`, `manage-attachment`) are in `FRONTEND-SPEC.md`. The short version: one Next.js app serves both the content-manager-facing submission form and the reviewer-facing dashboard, reading Supabase directly for anything that's just display and routing state-changing actions through its own trusted server layer (never the browser directly) — so client-side validation can be as strict and pleasant as it likes (a date picker that structurally can't select the past, instant file-type rejection) without ever being the thing the system actually trusts; the server layer still re-validates everything on receipt.

**Revised 2026-09-16:** those three contracts no longer forward to n8n. `content-request` now runs the full pipeline (§22) directly; `review-action` records the decision and, on approval, promotes this request's channel assets to `ready_to_publish`, or, on request-changes, triggers an immediate revision pass — all in the same process. n8n is no longer in the write path for intake or review at all; its only remaining job is the scheduled publish runner (§11).

**Built (2026-09-16):** a runnable Next.js scaffold exists in `frontend/` — Card/Kanban board (`/board`), the submit-request form (`/requests/new`), and the full draft-review screen (`/requests/[id]`: version history, draft viewer with per-section citation flags, evaluation panel including custom rubric criteria, channel-adapted copy for every priority channel, source list, activity trail, and approve/request-changes/reject actions). It runs entirely against seeded mock data (`NEXT_PUBLIC_USE_MOCK_DATA=true`, the default) so it's clickable end-to-end with no live Supabase or n8n — the mock re-implements the behaviors that matter, not just the screens: the `review_decisions` race guard (a second reviewer's decision on an already-decided draft is refused with a 409 and shown as a conflict banner), a `stale_draft` guard (a decision aimed at a superseded draft is also refused with a 409, not silently applied), and, since §22, the full pipeline itself running synchronously on submission. `npm install && npm run build && npm run typecheck` all pass; see `frontend/README.md` for how to run it and "Going from mock to real" for the cutover path (every read goes through `src/lib/data.ts`, every write through `src/lib/webhookClient.ts`, both gated on `USE_MOCK_DATA`, so no page or component needs to change when real Supabase/Claude/Firecrawl/Tavily/Voyage are wired in).

## 22. Content Generation Pipeline (Research → Channel Prep)

Supersedes §19 and §20. Full spec — request lifecycle, each stage's exact input/output shape, the mock-vs-real split, and the reasoning for moving this into Next.js instead of n8n + a standalone service — is in `CONTENT-PIPELINE-SPEC.md`. Built (2026-09-16) as real, runnable code in `frontend/src/lib/pipeline/` (`generate.ts` for the content-generation primitives, `run.ts` for orchestration), wired into the intake and review-action handlers in `frontend/src/lib/mock/webhooks.ts`. Verified live: submitting a new request runs research → curation → planning → drafting → evaluation → (when the first pass leaves a section uncited) one automatic revision round → channel prep for every priority channel, landing at `pending_human_review` with a full draft, evaluation history, and per-channel copy — including newsletter — already there for a reviewer to open, with no n8n or external API involved in mock mode.
