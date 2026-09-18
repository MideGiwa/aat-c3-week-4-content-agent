# Content Generation Pipeline — Spec

Covers everything between "a request is submitted" and "a human sees a reviewable draft with per-channel copy already prepared": Research & Retrieval, Source Curation, Planning, Draft Generation, Self-Evaluation, Revision, and Channel Prep. Supersedes `INTAKE-AND-RESEARCH-SPEC.md` (research/curation) and `LLM-SERVICE-SPEC.md` (planning through revision) — both are kept for history with a banner pointing here.

**Status: built.** Unlike its predecessor specs, this one describes code that exists — `frontend/src/lib/pipeline/generate.ts` (content-generation primitives) and `frontend/src/lib/pipeline/run.ts` (orchestration), wired into the intake and review-action handlers in `frontend/src/lib/mock/webhooks.ts`. It runs in mock mode today (`USE_MOCK_DATA`, same flag as the rest of the app) and is verified working end to end — see "Verified behavior" below.

## Why this moved into Next.js instead of n8n + a standalone service

The original plan (`DESIGN.md`'s architecture section, first draft) had n8n orchestrating a standalone Python/FastAPI service for every Claude call, reached over HTTP. That made sense when n8n was still the front door for the whole system. It stopped making sense once intake and human review moved into a custom Next.js front-end (`FRONTEND-SPEC.md`) — at that point n8n's only remaining unique value in this system was what it was always good at: a scheduler with ready-made platform API nodes for the publish runner (`DESIGN.md` §11). Keeping the generation stages behind a second service and an n8n hop added a network boundary, a second deployment target, and a second secret to manage (the LLM service's own auth), for no benefit once nothing else was calling that service. Running these stages as Next.js server code instead means one process, one deployment, and the same `USE_MOCK_DATA` mock/real seam already established for the rest of the app (`src/lib/data.ts`, `src/lib/webhookClient.ts`) — this pipeline uses that same pattern, not a new one.

n8n's remaining job at the time — the publish runner (`n8n-publish-workflow.json`) — is itself retired as of 2026-09-18 (`DESIGN.md` §11); n8n has no role anywhere in this system anymore.

## Request lifecycle through this pipeline

```
intake_complete
      │  Research & Retrieval + Source Curation
      ▼
(no separate status — mock mode runs the whole pipeline synchronously
 before the request is ever persisted at an intermediate stage; a real-mode
 background job would likely surface research_complete / drafting as real
 statuses here — see "Real mode" below)
      │  Planning → Draft Generation → Self-Evaluation → Revision (capped)
      │  → Channel Prep (LinkedIn, X, newsletter — all priority channels)
      ▼
pending_human_review
      │  human: approve ──────────────────────────▶ approved (channel
      │                                              assets → ready_to_publish)
      │  human: reject ───────────────────────────▶ rejected_by_human (terminal)
      │  human: request_changes ──▶ targeted revision pass (this spec, §7)
      │                              ──▶ back to pending_human_review
      ▼
(research_failed is a defined status — DESIGN.md's data model and
 EDGE-CASES-AND-GUARDRAILS.md describe the real failure path; the mock
 doesn't simulate a research failure for new submissions, see §1 below)
```

## 1. Research & Retrieval

**Input:** the `ContentRequest` — `idea_or_topic`, `target_audience`, `source_url` (optional), `tone`.

**Real mode:** if `source_url` is set, Firecrawl scrapes it directly. Otherwise a search API (Tavily/Exa, or Firecrawl's own search) finds 3–5 candidate sources on `idea_or_topic`, which are then scraped. Results are chunked (~500 tokens, ~50 token overlap — unchanged from the original spec) and embedded with Voyage AI (`voyage-3-lite`/`voyage-3`) into Supabase + pgvector.

**Mock mode** (`generateSources()` in `generate.ts`): fabricates 3–4 `SourceRef` rows — the provided `source_url` as a primary source if given, plus two on-topic synthetic sources, plus one deliberately irrelevant one for Source Curation to reject. No network calls, no embeddings. Deterministic given the same request.

**Failure path:** not simulated in mock mode — every new submission's research always "succeeds." A real research failure (no results found, scrape/timeout error) is a defined, designed-for case (`research_failed` status, `EDGE-CASES-AND-GUARDRAILS.md`, and the `req-4` seed example demonstrates what that looks like in the UI) — mock mode just doesn't have a trigger condition that produces it live. Documented gap, not an oversight.

## 2. Source Curation

Ranks and selects which retrieved sources actually support this piece; rejects the rest. Every source keeps a `relevance_note` regardless of outcome — "why was this excluded" is always answerable, and rejected sources stay visible (collapsed) in the review UI's Sources panel, not deleted.

**Real mode:** a Claude call scoring each chunk/source against the request's topic and audience.

**Mock mode:** folded into `generateSources()` — sources are created with `selected`/`relevance_note` already set, rather than as a separate pass. This is a scope simplification for the mock (see the function's doc comment); the *shape* of the output (a `SourceRef[]` with selection + reasoning) is what real mode has to produce, however many internal steps it takes to get there.

## 3. Planning

Proposes an angle for the piece before committing to a full draft.

**Scope decision:** the original ask was "generate article options" (plural). Rather than fully drafting and evaluating N complete competing articles (expensive, and duplicates the revise-loop across every option), planning generates **two title/angle options** and picks one with an explainable heuristic, logged to the activity trail as a `select_option` entry (`planTitleOptions()` in `generate.ts`) — e.g. "considered a direct-statement title vs. a question-format title; picked the direct one because the request's tone is professional." Only the chosen angle proceeds to drafting. If this scope decision turns out to be too narrow (e.g. a future requirement to show reviewers multiple full draft options side by side, not just see which one was picked), that's a straightforward extension of this function, not a rearchitecture — nothing downstream assumes there's only ever one option considered.

**Real mode:** the same two-options-then-pick shape, via a Claude call instead of the mock's tone-based heuristic.

## 4. Draft Generation

Produces a structured `Draft` (title + sections, each with `cited_source_ids`) from the plan and curated sources.

**Real mode:** a Claude call given the plan and the curated source excerpts, asked to write sections that cite specific sources for specific claims — not a wall of uncited text.

**Mock mode** (`generateDraft()`): templates 3 sections from the request and selected sources. Deliberately, the first pass leaves the *last* section without a cited source — a realistic first-draft gap, not a bug — so Self-Evaluation below has something concrete and specific to flag, and Revision has something concrete to fix. Every mock submission's first draft is `revise`, not `pass`, on purpose, so the full loop is demonstrable on every request rather than only in curated seed data.

## 5. Self-Evaluation

Scores the draft against the rubric — the PRD's default 9 criteria (Topic Relevance, Source Grounding, Factual Consistency, Audience Fit, Tone, SEO Fit, Channel Fit, Clarity, Completeness) plus any custom criteria the submitter added at intake for this specific request (`DESIGN.md` §13 — request-scoped, capped at 5, not a reusable channel/content-type registry).

**The contract that matters most, carried over unchanged from the retired `LLM-SERVICE-SPEC.md`:** this is a schema-validated structured output. A schema-validation failure is a hard error surfaced up the stack, **never** silently treated as a passing (or any) score — "never fail open." In real mode that's an HTTP-equivalent error from the Claude call's structured-output parsing; in mock mode there's no parsing step to fail, so this shows up as a design invariant to preserve when real mode is implemented, not as code to inspect today.

**Mock mode** (`evaluateDraft()`): most scores are computed from the draft's own shape rather than a language model's judgment. "Source Grounding" is what drives `status`/the revision loop — a section with no cited source measurably lowers it and drives `status: "revise"`; a fully-cited draft scores `"pass"`, keeping the loop deterministic and testable rather than randomly sometimes triggering. "SEO Fit" is also genuinely computed (2026-09-17 fix — it used to be a flat placeholder): it checks the draft against `assets/seo-best-practices.md`'s actual checklist — primary keyword (guessed from `idea_or_topic`) in the title and first ~100 words, an H1/H2-equivalent structure, and a 2+ link/citation count — and scores 0-10 by how many of those four checks pass. Any custom criteria are scored by a simple keyword-overlap heuristic against the criterion's description (explicitly labeled as a heuristic in its own notes, since mock mode can't actually judge open-ended criteria like "hook strength" the way a human or Claude would) — real mode has Claude score both SEO Fit and custom criteria directly against the prose instead.

## 6. Revision

If evaluation flags specific sections, revise only those — not a full regenerate-from-scratch — then re-evaluate. Capped at `MAX_AUTO_REVISION_ROUNDS = 1` automatic round (matches the original seed example, `draft-1` → `draft-2`); if still not passing after the cap, the draft proceeds to human review anyway with its evaluation history intact, rather than looping indefinitely or blocking on an AI that can't converge — a human always gets the final call regardless of whether the rubric is satisfied.

**Mock mode** (`reviseDraft()`): for each section the evaluation flagged, attaches the best remaining selected source and appends an explicit attribution phrase to the body. If reviewer notes are supplied (see §7), they're appended as a visible "(Addressed reviewer note: ...)" annotation on the first flagged section, so what changed and why is visible in the draft diff itself, not only in the activity log.

## 7. Channel Prep

Adapts the (possibly revised) final draft into per-channel copy for **every** channel in the request's `priority_channels` — LinkedIn, X, and newsletter alike. This runs regardless of whether a given channel currently has automated publishing wired up; channel-copy generation and channel-copy *distribution* are separate concerns (`DESIGN.md` §11 "Scope note"). Assets are created with `status: "draft"`.

**On human approval:** all of this request's `draft`-status channel assets for the approved draft are promoted to `ready_to_publish` (`promoteChannelAssetsToReadyToPublish()` in `run.ts`) — this is the "publish or schedule for release" step in full now (`DESIGN.md` §11, revised 2026-09-18): nothing consumes `ready_to_publish` rows automatically, for any channel, including LinkedIn/X. They're reviewable and "ready" in the queue, which is the deliverable.

**On request-changes:** old channel assets for the request are removed and replaced with fresh ones built from the newly-revised draft (`runRevisionPipeline()` in `run.ts`) — stale per-channel copy from a superseded draft is never left sitting next to a new version.

**Real mode:** a Claude call per channel using that channel's formatting rules (character limits, hashtag/thread conventions for X, subject-line conventions for the newsletter).

## 8. Human Review actions and their pipeline effects

Handled in `handleReviewActionWebhook()` (`src/lib/mock/webhooks.ts`), which calls into this pipeline module:

- **Approve** → records the decision, sets `request.status = "approved"`, promotes this draft's channel assets to `ready_to_publish`.
- **Reject** → records the decision, sets `request.status = "rejected_by_human"`. Terminal — no automatic regeneration (unchanged from the original design).
- **Request changes** → records the decision, then immediately runs `runRevisionPipeline()` with the reviewer's own notes: a new draft version, a new evaluation round, freshly regenerated channel copy, and `request.status` set back to `"pending_human_review"` — all before the webhook call returns. This resolves synchronously rather than leaving the request sitting at `needs_manual_revision` for any real duration in mock mode; that status still exists in the type system and board columns (and is what a slower, real-mode revision pass — an actual Claude call taking real wall-clock time — would genuinely rest at while the job runs).

**Stale-draft guard:** added 2026-09-16 while wiring this up. `review-action` now checks that `draft_id` matches the request's current latest draft before doing anything else — a decision aimed at a draft this pipeline has since superseded (e.g. a browser tab left open on an old version, or a retried/replayed request arriving after an automatic revision already produced a newer draft) is refused with `{ ok: false, reason: "stale_draft", current_draft_id }`, surfaced as HTTP 409 exactly like the pre-existing `already_decided` race guard, and shown in the UI (`ReviewActions.tsx`) as "this request has moved to a newer version — refreshing." Same "gate, don't guess" principle as the multi-reviewer race constraint; this one just wasn't a real risk until revisions started happening automatically and frequently.

## Verified behavior (2026-09-16)

Confirmed live against a running dev server, not just by reading the code:

- Submitting a new request runs the full pipeline synchronously and returns already at `pending_human_review`, with sources (one rejected as irrelevant), a round-1 evaluation (`revise`, missing citation flagged), an automatic revision (round 2, `pass`), and channel copy for all three requested channels (LinkedIn, X, newsletter) — all visible immediately on the request's detail page.
- Approving the current draft promotes its LinkedIn/X/newsletter assets from `draft` to `ready_to_publish`.
- Attempting to act on a superseded draft id is refused with `stale_draft` / HTTP 409.
- Requesting changes produces a new draft version with the reviewer's note visibly addressed in the section body, fresh channel copy, and the request back at `pending_human_review`.

## Real mode

Not implemented — this is mock mode only today, matching the rest of the scaffold. Wiring up real mode means replacing the insides of the functions in `generate.ts` (Firecrawl/Tavily/Voyage/Anthropic SDK calls in place of the templated logic) without changing `run.ts`'s orchestration or any calling code, the same seam `src/lib/data.ts` already uses. The one architectural question real mode has to answer that mock mode doesn't: whether this runs synchronously in the intake API route (fine while it's fast) or as a background job (likely once it involves real network calls and multi-second Claude generations) — either way, nothing above the pipeline module's own function signatures needs to change.
