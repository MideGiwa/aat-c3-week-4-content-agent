# Standalone LLM Service — API Spec

> **Superseded 2026-09-16.** This service was never built, and the plan changed: planning, drafting, evaluation, and revision are now Claude API calls made directly from the Next.js pipeline code (`CONTENT-PIPELINE-SPEC.md`), not a separate HTTP service called from n8n. The "never fail open" evaluation contract, the rubric-scoring shape, and the context-budget reasoning below are all still accurate and now live in the new spec — only *where the code runs* changed. Kept here for history; see `DESIGN.md` §20 and the 2026-09-16 Decisions Log entry for why.

A small, stateless HTTP service wrapping every Claude API call in the pipeline — source curation ranking, content planning, draft generation, rubric-based evaluation, targeted revision — behind clean JSON endpoints that n8n calls via HTTP Request nodes.

**It owns prompts and structured-output schemas. It does not own orchestration or persistence** — n8n remains the single source of truth for request state, and Supabase remains the only database. Keeping the service a pure function (input in, structured output out, nothing written anywhere) is what makes it easy to test in isolation and safe to redeploy without any state to migrate.

## Tech choice

**Python + FastAPI + Pydantic + the Anthropic Python SDK.** Reasoning: Pydantic models double as both request/response validation *and* the JSON schema handed to Claude's structured-output feature — defined once, used for both, so the service's contract and the model's output shape can't drift apart. FastAPI auto-generates OpenAPI docs, which is a genuinely useful reference when wiring up n8n's HTTP Request nodes against this service. It packages into one small container with one process and one port.

## Auth

Every request from n8n includes header `X-Service-Key: <shared secret>`. The service rejects anything else with `401`. This is an internal service reachable only from the orchestration layer — no per-user auth needed, just a shared secret so it isn't wide open to the internet.

## Endpoints

### `POST /curate-sources`
**Request:**
```json
{
  "request_id": "uuid",
  "topic": "string",
  "audience": "string",
  "candidate_chunks": [
    { "chunk_id": "uuid", "source_id": "uuid", "source_url": "string", "text": "string" }
  ]
}
```
**Response:**
```json
{
  "selected": [
    { "chunk_id": "uuid", "relevance_note": "string", "relevance_score": 0.0 }
  ],
  "rejected_count": 0
}
```
Ranks and filters `candidate_chunks` for relevance to `topic` + `audience`. If nothing clears the relevance floor (default `0.5` on a 0–1 scale, configurable), `selected` comes back empty — n8n's job from there is to halt the request at `no_relevant_sources`, per the existing gate in `EDGE-CASES-AND-GUARDRAILS.md`.

### `POST /plan`
**Request:**
```json
{
  "request_id": "uuid",
  "topic": "string",
  "audience": "string",
  "tone": "string",
  "selected_chunks": [{ "chunk_id": "uuid", "text": "string" }],
  "custom_rubric_criteria": [{ "name": "string", "description": "string" }]
}
```
**Response:**
```json
{
  "primary_keyword": "string",
  "secondary_keywords": ["string"],
  "outline": [
    { "section_heading": "string", "source_chunk_ids": ["uuid"] }
  ]
}
```
Every outline section must cite at least one `selected_chunks` id. A section that can't be grounded in the given chunks is **omitted from the outline**, not invented — checked server-side before the response is returned, so n8n never has to separately catch an ungrounded section from this endpoint.

### `POST /draft`
**Request:**
```json
{
  "request_id": "uuid",
  "draft_version": 1,
  "plan": { "...": "the /plan response" },
  "selected_chunks": [{ "chunk_id": "uuid", "text": "string" }],
  "option_count": 2
}
```
**Response:**
```json
{
  "options": [
    {
      "option_label": "A",
      "title": "string (≤60 chars)",
      "sections": [
        { "heading": "string", "body": "string", "cited_chunk_ids": ["uuid"] }
      ],
      "word_count": 0
    }
  ]
}
```
Generates `option_count` article drafts per the SEO best practices. Every paragraph is checked against the chunk ids it was given — the service flags (rather than silently ships) any paragraph with no `cited_chunk_ids`, since that's the unsupported-claim pattern the evaluation stage exists to catch, and it's cheaper to flag it here than discover it later.

### `POST /evaluate`
**Request:**
```json
{
  "request_id": "uuid",
  "draft_id": "uuid",
  "draft_content": { "...": "the draft being scored" },
  "rubric_criteria": [{ "name": "string", "scope": "default | custom" }],
  "selected_chunks": [{ "chunk_id": "uuid", "text": "string" }]
}
```
**Response:**
```json
{
  "overall_status": "pass | revise | reject",
  "scores": [{ "criterion": "string", "score": 0, "notes": "string" }],
  "unsupported_claims": ["string"],
  "sections_needing_revision": ["string"]
}
```
**This is the "never fail open" endpoint.** If Claude's response fails schema validation — even after one internal retry — the service returns **HTTP 422** with error code `evaluation_unparseable` rather than ever synthesizing a fake "pass." n8n must treat a 422 here as an immediate escalation to a human, never as a normal retryable failure and never as a pass by default.

### `POST /revise`
**Request:**
```json
{
  "request_id": "uuid",
  "draft_id": "uuid",
  "previous_draft": { "...": "the current draft" },
  "evaluation": { "...": "the /evaluate response that triggered this" },
  "selected_chunks": [{ "chunk_id": "uuid", "text": "string" }],
  "reviewer_notes": "string, optional — set when a human triggered this via 'request changes'"
}
```
**Response:**
```json
{
  "revised_sections": [
    { "heading": "string", "body": "string", "cited_chunk_ids": ["uuid"] }
  ]
}
```
Only regenerates the sections `evaluation.sections_needing_revision` flagged (or that `reviewer_notes` calls out). Everything else is left untouched — a revision can't accidentally alter a section nobody asked to change.

## Error handling (all endpoints)

| Status | Meaning | n8n's response |
| --- | --- | --- |
| `400` | Malformed request (missing required field) | Shouldn't happen if built correctly — treat as a bug to fix, not a gate failure to handle gracefully |
| `422` | Model output failed schema validation after one internal retry | Escalate immediately (this is the "never fail open" case, most critical on `/evaluate`) |
| `429` / `5xx` (from Claude itself) | The service retries once internally with backoff, then surfaces `503` | n8n logs to `stage_logs` and either retries the step later or escalates, per the per-request failure isolation in `DESIGN.md` §15 |

## Context window budgeting (concrete numbers)

- Every call caps total input context at **~12,000 tokens**, well under typical model context limits, leaving headroom for the system prompt and a lengthy structured-output response.
- `/curate-sources` may receive many candidate chunks. If the combined text would exceed the budget, the service pre-filters to the top-N by a cheap keyword-overlap heuristic *before* ever calling Claude — never truncates mid-call.
- `/draft` and `/revise` only ever receive `selected_chunks` (already curated) — never the full raw source text. The curation step is what keeps everything downstream bounded.

## Logging

The service does not write to Supabase itself. Every response includes a `usage` field (`{ input_tokens, output_tokens }`) so the calling n8n workflow writes its own `stage_logs` row with real numbers — keeping all persistence in the one place (Supabase, via n8n) rather than split across two systems that could drift out of sync.

## Deployment (suggested, not provisioned in this pass)

One Dockerfile, one process, one port (e.g. `8000`), configured via environment variables (`ANTHROPIC_API_KEY`, `SERVICE_SHARED_KEY`, `VOYAGE_API_KEY` if embeddings are proxied through here rather than called directly from n8n). Runs anywhere that hosts a small container — Render, Railway, Fly.io, or alongside a self-hosted n8n instance. n8n's HTTP Request nodes just need a reachable base URL and the shared-secret header.
