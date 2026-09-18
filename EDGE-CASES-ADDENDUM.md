# Edge Cases Addendum — Round 2

A second review pass, separate from `EDGE-CASES-AND-GUARDRAILS.md` (which covers the original stage-by-stage technical review). This one logs the edge cases that came out of a more product-focused round of questions: rubric extensibility, draft versioning, supporting-material uploads, multi-reviewer review, reject vs. request-changes, scheduling, and cross-request failure isolation. Each entry says why it was added and exactly how it's handled — see `DESIGN.md` for the fuller design context each of these links back to.

## 1. Corrupt uploaded supporting material

**Why added:** a request can now include an uploaded file, not just a URL. Files fail — a truncated PDF, a `.docx` that's actually a renamed different file type, a spreadsheet with a broken header row. Nothing previously described what happens when the file itself is unusable.

**How handled:** every upload is parse-tested immediately on arrival (attempted to open/read as its declared type). A file that fails is marked `corrupt` in `request_attachments` and the submitter is prompted to re-upload. A corrupt file is never handed downstream to research or drafting as if it were readable content — this is a hard gate, not a warning.

## 2. Disallowed file type uploaded

**Why added:** without an explicit allowlist, any file type could be uploaded, including ones the pipeline has no way to extract text from (images, archives, executables).

**How handled:** only `.txt`, `.pdf`, spreadsheet (`.xlsx`/`.csv`), and `.docx` are accepted. Anything else is rejected at the point of upload with a message naming the accepted types — never silently accepted and then failing later, deeper in the pipeline.

## 3. Supporting material edited or removed mid-request

**Why added:** a submitter may realize they attached the wrong file, or want to add a follow-up document, after the request is already in flight.

**How handled:** attachments can be edited or removed any time before the request has actually entered Research & Retrieval. If research has already consumed a file (chunked and embedded it) by the time it's removed, the removal stops it from being used in any future regeneration, but doesn't retroactively strip chunks already embedded into a draft someone may currently be reviewing — silently changing the grounding under an in-review draft would be worse than leaving it consistent until the next regeneration. Every add/edit/removal is written to `activity_log` so it's visible who changed what and when.

## 4. Draft regeneration losing prior history

**Why added:** once regeneration is possible (automatic on a failed rubric check, or manual via a reviewer's "request changes"/"regenerate"), there's a real risk that a naive implementation overwrites the previous draft in place, losing the ability to see what changed or roll back.

**How handled:** every regeneration writes a *new* row to `drafts` with an incremented `version` — nothing is overwritten. Full version history stays pageable. Two companion views make the history usable rather than just stored: the evaluation timeline (`evaluations`, every round's scores and notes) and the activity trail (`activity_log`, every human and system action with a timestamp).

## 5. Two reviewers acting on the same draft at the same time

**Why added:** supporting multiple reviewers on one request introduces a genuine race — two people could both open the same draft and both click a decision within seconds of each other.

**How handled:** decisions are enforced with a uniqueness constraint per draft/channel-asset. Whoever's decision lands first is recorded; a second, conflicting action arriving after that is refused with an explicit "already decided by \<reviewer\>" message rather than silently overwriting or double-processing. Every reviewer's action (including the refused one, as an audit entry) lands in `activity_log`. Comments remain open to all reviewers regardless of who has final say.

**Update (2026-09-16):** this is now a concrete `review_decisions` table with a real `UNIQUE` constraint on the target draft/channel-asset (`DESIGN.md` §6), not just a described policy — see `FRONTEND-SPEC.md` for how the front-end's review action flows through it and surfaces a conflict live via Supabase Realtime.

## 6. Reject vs. Request Changes ambiguity

**Why added:** a single "reject" action is ambiguous — does it mean "kill this forever" or "send it back for another pass"? Left undefined, a reviewer could reasonably expect either behavior, and the system would have to guess.

**How handled:** these are two explicit, separate actions. **Reject** is terminal — the request ends, the submitter is notified, nothing regenerates automatically. **Request Changes** sends the current draft into the revision loop with the reviewer's notes attached, reusing the same capped, history-preserving mechanism the automatic rubric-triggered revision already uses.

## 7. Sources tracked internally but never shown publicly

**Why added:** the PRD requires the system to "make it clear which sources informed the output," but that's easy to satisfy purely as an internal audit trail while the actual published article cites nothing — technically traceable, but not transparent to the reader.

**How handled:** the full source list is always retained internally regardless of what's public-facing. Separately, per the SEO best practices' link guidance, relevant sources are also surfaced in the article itself — inline at the claim they support, or in a closing "Sources"/"Further reading" section — when appropriate, rather than leaving citation entirely to an internal-only record.

## 8. Scheduling a post in the past

**Why added:** a scheduled-for timestamp could end up in the past either from direct user error (picking a past date) or indirectly from system downtime (a schedule set for a valid future time that passes while the system was offline).

**How handled:** two separate guards. At the point of scheduling, `scheduled_for` must be null or strictly in the future — a past timestamp is rejected at input, before it's ever saved. Separately, the publish runner's stale-schedule guard (already built — see `EDGE-CASES-AND-GUARDRAILS.md`) catches the downtime case: anything that legitimately was scheduled for the future but is now more than 24 hours overdue gets pulled into `stale_needs_review` instead of being auto-published as a backlog dump.

## 9. One stage's failure cascading beyond its own request

**Why added:** the PRD explicitly calls this out — "a failure in step 2 should not kill the entire process" — which is a system-level reliability requirement, not just a per-stage error message.

**How handled:** every request is processed as an independent unit of work keyed by its own request ID, with its own status and its own rows in every table. A failure anywhere updates only that request's status and logs it; it's structurally unable to throw an exception that stops the orchestrator from processing other, unrelated requests, because there's no shared in-memory state across requests to begin with.

## 10. Large supporting material blowing the context window

**Why added:** an uploaded file (a long PDF, a large spreadsheet) could easily be larger than what fits — or than what's sensible to send — in a single LLM call.

**How handled:** large files are chunked and embedded exactly like a scraped web source, and only the top-K relevant chunks are retrieved into any given prompt — never the full raw file text. See `DESIGN.md` §16 for the fuller context-window approach this fits into.
