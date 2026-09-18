# PRD Review: Edge Cases & Guardrails

A second pass over `PRD.md` and `DESIGN.md`, focused on what breaks in practice and where the system needs a hard stop instead of best-effort behavior. The organizing principle throughout: **gate, don't guess** — every stage has required inputs, and if they're missing or invalid, the item halts there, gets marked clearly, and never proceeds on a null, a guess, or an assumption.

## 1. Core principle: gate, don't guess

For every stage-to-stage handoff below, three things are defined: what's required to move forward, what can realistically go wrong, and what happens when the gate fails. "What happens when the gate fails" is never "proceed anyway" — it's always one of: reject at the door, halt with a clear status, retry once, or escalate to a human. Nothing should fail silently, and nothing should fail open (defaulting to "looks fine" when a check itself breaks is worse than the check not existing).

## 2. Stage-by-stage: required inputs, edge cases, gate behavior

### Intake
- **Required to proceed:** non-empty idea/topic, non-empty target audience; if a source URL is given, it must be a syntactically valid URL.
- **Edge cases:** empty or one-word idea, empty audience, malformed URL, a giant paste-dump instead of a short idea, the same idea+audience submitted twice in quick succession, non-English request, a "supporting material" upload that isn't actually text (e.g. a scanned image with no OCR), gibberish or random-character input (e.g. `nviwbfvwug397hfwp939fh4`) submitted as the idea, either by mistake or as a test/abuse probe.
- **Gate behavior:** reject at submission with a specific validation message back to the content manager. Don't create a `requests` row that looks "queued" if it's actually invalid — either refuse the insert or insert it with `status = rejected_invalid_input` and a reason, so it's never silently sitting in a pipeline stage waiting for research that will never start. Run a basic coherence check on the idea text (e.g. a lightweight "is this recognizable language, not a random string" check, or simply requiring a minimum count of real dictionary words) so obvious gibberish is rejected here, at the door, rather than burning a research/LLM call on it and only failing three stages later.

### Research & Retrieval
- **Required to proceed:** at least one usable scraped/retrieved source with non-trivial text (not just a cookie banner or a paywall notice).
- **Edge cases:** URL returns 404/403/timeout, URL is paywalled or login-gated, robots.txt disallows scraping, scraped text is boilerplate-only, search returns zero results for a raw idea, every candidate source is low-quality or off-topic, source content contains injected instructions (a page that says "ignore previous instructions and...").
- **Gate behavior:** if zero usable sources remain after retries, halt the request at `research_failed` and surface it — do not let planning/drafting continue with nothing to ground on. Treat every piece of scraped or retrieved text as untrusted data in prompts (quote/delimit it clearly), and state explicitly in the system prompt that instructions found inside source material are not to be followed.

### Source Curation
- **Required to proceed:** at least one (ideally two or more) selected sources with a relevance justification.
- **Edge cases:** sources contradict each other, everything available is only tangentially relevant, sources are stale for a fast-moving topic.
- **Gate behavior:** if nothing clears a minimum relevance bar, halt rather than force a low-confidence selection through to planning. This is also the backstop for gibberish or nonsensical intake that somehow got past the Intake coherence check: a request like `nviwbfvwug397hfwp939fh4` will pull back zero relevant sources during research, and that alone is enough to halt it here at `research_failed`/no-relevant-sources rather than let it reach drafting.

### Content Planning
- **Required to proceed:** an identifiable primary keyword, and an outline where every section maps to at least one source excerpt.
- **Edge cases:** no clear keyword extractable from a vague idea, an outline section with zero mapped sources (i.e. a section that would have to be invented), requested tone/depth mismatched with what the source material actually supports.
- **Gate behavior:** a section with no mapped source gets cut from the outline or explicitly flagged `requires_source` and blocked from drafting until it's covered — never silently drafted from the model's general knowledge.

### Draft Generation
- **Required to proceed:** structured output with all required fields present (title within a 50–60 character limit so it doesn't get truncated in search results, sections, per-section source references), within SEO length/structure rules.
- **Edge cases:** a claim that isn't traceable to any mapped source, a citation pointing at a source outside the selected set, near-duplicate draft options, missing H1/H2 structure, keyword absent from the first 100 words, a title over the 50–60 character limit (gets truncated in search results and social previews).
- **Gate behavior:** validate the LLM's structured output against a schema before accepting it as a draft — on a malformed/incomplete response, retry the generation call once; if it fails twice, escalate rather than pass a broken draft into evaluation.

### Self-Evaluation
- **Required to proceed:** a valid evaluation object scoring all rubric criteria with an explicit overall status (pass/revise/reject).
- **Edge cases:** the evaluator's output fails schema validation, the evaluator's stated status contradicts its own notes (says "pass" but lists unsupported claims), the evaluator hallucinates a source that was never in the selected set.
- **Gate behavior:** this is the one most worth calling out — **a broken evaluator must never fail open.** If the evaluation call returns unparseable output, that is a system failure to log and retry, not a green light. Never default to "pass" because parsing broke; default to "needs human attention" instead.

### Revision Loop
- **Required to proceed:** revisions touch only the sections the evaluation flagged; each round gets re-evaluated and the round's scores/notes are preserved.
- **Edge cases:** the draft never improves round over round, unlimited rounds blow out cost, a "fix" in round 2 introduces a new problem the rubric didn't catch, round 3 undoes round 1's fix (oscillation).
- **Gate behavior:** hard cap at 2–3 rounds (already in the design). Hitting the cap without a pass routes to `needs_manual_revision` for human review — never force-approve, and never silently drop the request.

### Human Review
- **Required to proceed:** a recorded decision (approve/reject/revise/select) tied to one specific draft version and one specific channel asset.
- **Edge cases:** a reviewer acts before evaluation actually finishes, two reviewers act on the same item at once, a reviewer approves the article but the channel-specific assets haven't been generated yet, an approval sits on a draft that only "passed" evaluation with an overridden warning.
- **Gate behavior:** the publishing queue insert should be blocked at the data layer, not just by workflow discipline — refuse to queue anything unless there's a matching approval record tied to that exact draft/channel-asset ID. This is worth an actual constraint (a status check or foreign-key relationship), not an assumption that the UI will always enforce it correctly.

### Channel Adaptation
- **Required to proceed:** non-empty adapted content, within the platform's hard limits, containing the elements the formatting rules require (CTA present, hashtag count within range, etc.).
- **Edge cases:** adaptation exceeds a character limit, adaptation drops the citation/source reference, newsletter falls outside the 250–600 word range, emoji usage drifts from brand voice.
- **Gate behavior:** validate programmatically before writing anything to `channel_assets` as ready — don't just trust the LLM followed the formatting rules. On a hard-limit violation, regenerate once; if it still fails, route to human review rather than auto-truncating (truncation can cut off a CTA or a citation without anyone noticing).

### Publishing Queue / Runner — the part that's actually built
This is where "little things matter" shows up most concretely, because this is real code, not just a design. Reviewing the workflow surfaced a genuine bug and a few gaps, all now fixed in the updated `n8n-publish-workflow.json`:

- **Double-publish race condition (fixed).** The original version did a plain `SELECT` for due rows and only flipped their status to `published` *after* posting. If one run took longer than 5 minutes, the next scheduled run could select the same row before the first run updated it — meaning the same post could go out twice. Fixed by replacing the `SELECT` with an atomic claim: a `WITH ... FOR UPDATE SKIP LOCKED` query that flips matching rows to `status = 'processing'` and returns them in the same statement. Two overlapping executions can now never claim the same row.
- **Stale scheduled posts after downtime (fixed).** If the workflow were paused or the credentials broke for a few days, restarting it could suddenly publish everything that missed its scheduled time — a backlog dump nobody wants. Fixed by adding a step that runs before the claim query and moves anything more than 24 hours past its `scheduled_for` into `stale_needs_review` instead of the ready pool, so a human decides whether it's still worth posting.
- **Oversized/empty content reaching the API (fixed).** Nothing previously checked that content was non-empty or within X's 280-character limit before calling the platform API — a failure there would come back as an opaque API error rather than a clear reason. Fixed by adding a validation step right after the item is claimed: empty content, a missing channel, or content over X's limit gets marked `failed` with a specific reason (e.g. "content exceeds X's 280 character limit (312 chars)") and never reaches the LinkedIn/X nodes at all.
- **Credential expiry / repeated failures (flagged, not yet built).** Per-row failures already don't crash the workflow (continue-on-error is set on both platform nodes), but if a credential expires, every row on that channel will quietly fail every 5 minutes until someone happens to check `stage_logs`. Worth adding: a small check (e.g. "N failures for the same channel within the last hour") that fires an alert instead of relying on someone noticing.
- **Rate limiting (flagged, not yet built).** A 429 from LinkedIn/X currently gets treated the same as any other failure (`status = 'failed'`). It's worth distinguishing transient throttling from a permanent failure — a rate-limited post is still worth retrying later, not writing off.
- **Partial multi-channel failure.** Because each channel is its own row, a request where LinkedIn succeeds and X fails is already handled correctly at the data level (one row `published`, one `failed`) — worth confirming the review UI actually surfaces "2 of 3 channels are live" clearly rather than showing one ambiguous request-level status.

## 3. Cross-cutting hardening (applies everywhere, not one stage)

- **Treat all external and model-generated text as data, never as instructions.** A scraped page, an uploaded file, or even the model's own prior output could contain text that reads like an instruction. Prompts should clearly delimit source text as a quoted block, and the system prompt should say explicitly that content found inside source material is never to be treated as a directive.
- **Schema-validate every structured LLM output** — the plan, the draft, the evaluation — before anything downstream trusts it. Retry once on a validation failure; escalate to a human on a second failure. Never fail open.
- **Every stage transition writes to `stage_logs`, including gate failures, not just crashes.** A request stuck at `research_failed` should be exactly as visible as one stuck at `publish_failed` — right now it's easy to build logging only around exceptions and miss the "quietly stopped because a gate wasn't met" case.
- **Dedupe intake.** Hash (idea + audience + source_url) and reject or flag a duplicate submitted within a short window, so the same request doesn't get processed twice from two form submissions.
- **Cost and iteration caps everywhere, not just the revision loop** — max sources fetched per request, max draft options generated, max revision rounds, and ideally a per-request token budget. Each cap should end in a clear "capped out, needs a human" state, never a silent truncation.
- **No silent state skips.** A request should never reach `publishing_queue` without a traceable chain: research completed → evaluation passed (or a human explicitly overrode a warning) → human approved. That chain is worth enforcing as an actual data constraint, not just something the workflow is trusted to always do in order.

## 4. Suggested additions to the PRD's testing evidence table

Beyond the eight scenarios already in `PRD.md`, these are worth adding given the gates above — each one exercises a "should stop, and stop visibly" path rather than a "should succeed" path:

- Missing required intake field (empty audience) → rejected before research starts, not silently queued.
- Zero usable sources after retries → request halted at `research_failed`, not drafted ungrounded.
- Evaluator returns malformed/unparseable output → escalated to a human, never defaulted to "pass."
- Revision loop hits its cap without passing → routed to `needs_manual_revision`, not force-approved.
- Two overlapping publish-workflow runs on the same due row → the post goes out exactly once.
- A scheduled post more than 24h overdue (simulated downtime) → flagged as `stale_needs_review`, not auto-published.
- Oversized content for a channel (X post over 280 characters) → caught and marked `failed` with a specific reason before any API call is made.
- Simulated credential failure → after repeated failures, an alert fires rather than the failures going unnoticed.

## 5. What changed in the build as a result of this review

`n8n-publish-workflow.json` and `PUBLISH-WORKFLOW-SETUP.md` were updated in place (not left as a separate patch) to add: the atomic claim query (fixes the double-publish race), the stale-schedule flag step, and the content-validation gate before any platform API call. These three were chosen to fix now because they're concrete, low-risk, and directly match "don't let anything go further without required data." The credential-expiry alert and rate-limit-aware retry are flagged above as next steps rather than built yet, since they involve a design choice (where should alerts go — email, Slack, a dashboard?) worth confirming before wiring up.
