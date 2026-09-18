# Intake, Research & Retrieval, Source Curation — Technical Spec

> **Superseded 2026-09-16.** These stages were never built in n8n, and the plan changed: they now run as Next.js server code in the same app as the front-end, alongside planning/drafting/evaluation/revision/channel-prep — see `CONTENT-PIPELINE-SPEC.md`, which is now built as real code (`frontend/src/lib/pipeline/`). The request field table, validation rules, and chunking/embedding parameters below are still accurate reference material; only the "n8n receives this" framing is stale. Kept here for history; see `DESIGN.md` §19 and the 2026-09-16 Decisions Log entry.

Covers pipeline stages 1–3 (`DESIGN.md` §5) at build-ready detail: exact request fields, validation rules, API call shapes, chunking/embedding parameters, and failure paths. This is a design pass, not workflow code yet — the goal is that building this in n8n afterward is mostly translation, the way `EDGE-CASES-AND-GUARDRAILS.md` and the hardening pass preceded actually building the publish runner.

Source Curation's *ranking logic itself* (which excerpts are relevant) is a Claude call and lives in the LLM Service (`LLM-SERVICE-SPEC.md`, `POST /curate-sources`) — this doc covers the data flow around it: what gets fetched, chunked, embedded, and handed to that endpoint, and what happens with what it returns.

## 1. Intake

**Mechanism (revised 2026-09-16):** a custom front-end, not n8n Form Trigger — see `FRONTEND-SPEC.md` for the app itself (auth, UI, client-side validation, the review dashboard it doubles as). This doc covers the **n8n side**: the webhook that receives a submission after the front-end's own validation has already run, and what n8n does with it. The front-end is the trusted browser-facing layer; n8n is still where every gate is *enforced* — nothing here assumes the client validated correctly, because a request could in principle come from anything that knows the webhook URL, not only the real front-end.

**Webhook:** `POST /webhook/content-request`, called server-side from the front-end's own backend (never directly from the browser — see `FRONTEND-SPEC.md` §"Security"), authenticated with a shared secret header (`X-Webhook-Secret`).

**Request fields** (the webhook's JSON body — the front-end's form maps directly onto these):

| Field | Type | Required | Validation (re-checked here, not just trusted from the client) |
| --- | --- | --- | --- |
| `idea_or_topic` | text | yes | non-empty; at least 3 space-separated tokens and 15 characters (cheap gibberish filter — see note below) |
| `target_audience` | text | yes | non-empty |
| `source_url` | text | no | valid URL format if present |
| `attachment` | object (`storage_path`, `file_type`, `original_filename`) | no | `file_type` one of `txt`/`pdf`/`spreadsheet`/`docx`; the file itself was already uploaded to Supabase Storage by the front-end before this webhook fires — n8n receives a path, not raw bytes |
| `tone` | text | no | free text, defaults to "professional" if blank |
| `priority_channels` | array | no | subset of `linkedin`/`x`/`newsletter`; defaults to all three |
| `publish_timing` | enum | yes | `"immediately"` or `"scheduled"` |
| `scheduled_for` | ISO8601 datetime | required if `publish_timing = "scheduled"` | must be strictly after the current time **at the moment n8n checks it**, not just when the browser rendered the form — closes the gap where a request sits in a slow network for a minute and would otherwise sneak a near-past timestamp through client-side-only validation |
| `reviewer_ids` | array of profile ids | no | defaults to a configured default reviewer list if empty; each id must exist in `profiles` |
| `submitted_by` | profile id | yes | must match the authenticated session the front-end's server validated |

**Gibberish filter note:** a real coherence check (e.g. "is this recognizable language") is more than an MVP needs. The cheap version — minimum length plus a minimum token count — catches the obvious case (`nviwbfvwug397hfwp939fh4`) without needing an NLP dependency. A stronger check (dictionary-word ratio, or a quick LLM call) is a reasonable v2 improvement, not a blocker for v1.

**On receiving the webhook, the n8n workflow:**
1. Re-validates every field in the table above, server-side — this is the actual gate; the front-end's own validation (§`FRONTEND-SPEC.md`) is a UX convenience, not the enforcement point. A failing check returns a `422` with a specific field-level error the front-end surfaces to the submitter, and **no `requests` row is created.**
2. Postgres: insert into `requests` with `status = 'intake_complete'`.
3. If `attachment` was provided: fetch it from the given Supabase Storage path, run the parse-test (below), insert into `request_attachments`.
4. Postgres: insert `request_reviewers` rows for each `reviewer_id` (or the default list).
5. Postgres: insert an `activity_log` row (`actor_type = human`, `actor_id = submitted_by`, `action = submit_request`).
6. Respond `200 { request_id, status: "intake_complete" }` to the front-end, then continue directly into Research & Retrieval in the same workflow execution.

**Why re-validate server-side when the front-end already did:** this is the actual reason a custom front-end "makes guardrail handling easier" rather than harder — it adds a *second*, better UX layer (a date picker that structurally can't select a past date, instant file-type rejection before upload even starts, inline field errors) without removing the enforcement layer n8n already had. Client-side validation is UX; the n8n gate is what the system actually trusts.

**Attachment parse-test** (per file type — a parse failure sets `request_attachments.status = 'corrupt'` and responds to the front-end with which file failed, for it to prompt a re-upload; nothing corrupt is ever handed downstream):

| Type | Test |
| --- | --- |
| `.txt` | Read as UTF-8; non-empty after trim |
| `.pdf` | Extract text (n8n's "Extract from File" node, or a PDF library); non-empty extraction |
| `.xlsx` / `.csv` | Parse first sheet/rows (n8n's "Spreadsheet File" node); at least one data row |
| `.docx` | Extract text (e.g. via a `.docx`-to-text library); non-empty extraction |

## 2. Research & Retrieval

**Branch on whether `source_url` was given:**

### A. URL given → Firecrawl scrape
- Call Firecrawl's `/v2/scrape` with `{ url, formats: ["markdown"], onlyMainContent: true }`.
- On failure (non-2xx, timeout, robots.txt block): retry once after a 5-second delay. Still failing → `requests.status = 'research_failed'`, `reason = 'source_unreachable'`, Discord alert, stop. No draft is attempted with zero source material.
- On success: check extracted markdown is at least ~200 words. Shorter (a cookie-banner page, a paywall stub) is treated as a failed scrape — same failure path above, not silently used as-is.

### B. No URL → search + scrape
- Call the search API (Tavily, or Firecrawl's `/search`) with `query = idea_or_topic`, `limit = 5`.
- Zero results → `research_failed`, `reason = 'no_search_results'`, Discord alert, stop.
- For each of the top 3–5 results: run the same Firecrawl scrape + length check as branch A. Collect the successes.
- Zero successful scrapes → `research_failed`, `reason = 'no_usable_sources'`, Discord alert, stop.
- At least one success → proceed with whatever succeeded, even if fewer than requested (the gate is "at least one usable source," per `DESIGN.md` §2 and the PRD).

### Chunking & embedding (applies to every source, scraped or uploaded)
- Split each source's text into chunks of **~500 tokens with ~50 token overlap**, on sentence boundaries where possible (avoid cutting mid-sentence).
- Embed each chunk via Voyage AI (`voyage-3-lite`, batched ~50 chunks per API call to cut down on request count).
- Insert into `sources` (one row per source/file) and `source_chunks` (one row per chunk, with its embedding vector).
- A large uploaded document (e.g. a long PDF or spreadsheet) goes through the identical chunk-and-embed path — never handed whole into a later prompt (ties to `DESIGN.md` §16, context window management).

### Handoff to Source Curation
- Run a broad similarity search (pgvector, top ~30 chunks against `idea_or_topic` + `target_audience`) to narrow the candidate set before it ever reaches the LLM — this keeps the `/curate-sources` call's input bounded regardless of how much was scraped.
- Call the LLM Service's `POST /curate-sources` with those candidates.
- Write the response back: mark selected chunks (with their relevance notes) in `source_chunks`; if `selected` comes back empty (nothing cleared the relevance floor), halt at `research_failed`/`reason = 'no_relevant_sources'` — the gate already described in `EDGE-CASES-AND-GUARDRAILS.md` §"Source Curation."
- Update `requests.status = 'research_complete'` only on a non-empty selection.

### Notification behavior
Consistent with the publish runner's Discord pattern: alerts fire on every failure path above (`research_failed`, whatever the reason), never on ordinary success — research completing normally isn't actionable, so it stays quiet.
