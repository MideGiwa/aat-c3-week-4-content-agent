# Business Questions — Round 2

Non-technical questions worth putting to whoever owns this project (a content lead, program manager, or client) — these are policy/product calls, not implementation details, and the design has made a reasonable default choice for each so the build isn't blocked, but each default is worth confirming rather than assuming. These sit alongside the original list in `DESIGN.md` §9.

## 1. Does any content need more than one reviewer's sign-off?

The default is "first decisive action wins" — whichever assigned reviewer approves, rejects, or requests changes first is the outcome, even if other reviewers are also assigned. That's simple and fast, but it means a single reviewer can single-handedly approve something client-facing or sensitive without a second set of eyes. **Should some categories of content (e.g. anything going to a specific client, anything touching legal/financial/health topics) require two independent approvals instead of one?**

## 2. Who can create or edit custom rubric criteria?

The rubric is now extensible — criteria can be added on top of the PRD's default 9, scoped to a channel or content type. **Should that be open to any content manager, or restricted to a content lead / admin role?** Left open, criteria could proliferate inconsistently across the team; restricted, it adds a bottleneck. Worth a policy decision either way.

## 3. Should sources be visibly cited in the public-facing content, or kept internal-only?

Sources are always tracked internally for traceability — that's non-negotiable per the PRD. But whether they're also *shown* to the public (inline links, a "Sources" section) is a separate, more editorial choice. Some brands want visible sourcing as a trust signal; others prefer not to visibly point readers at competitor or third-party content. **What's the house policy on public citation, and does it vary by channel (e.g. fine for the article, not for a short X post)?**

## 4. Is there a retention/storage policy for uploaded supporting material?

Uploaded files (PDFs, spreadsheets, docs) may contain client data. **How long should attachments be retained after a request is complete, and is there a data-handling constraint (e.g. deletion on request, no long-term storage of client-provided files) that the design needs to account for?**

## 5. What's the expected turnaround time from submission to a reviewable draft?

The current design's research stage is estimated at roughly 15–45 seconds, with full draft-and-evaluation turnaround likely a few minutes before a human ever sees it — see `DESIGN.md` §17. **Is there an actual SLA expectation here (e.g. "must be ready to review within 5 minutes" vs. "a few minutes is fine, depth matters more than speed")?** This affects choices like how many sources to fetch and whether steps run in parallel.

## 6. When is a rejected request considered "worth trying again"?

Reject is designed as terminal — no automatic regeneration, a brand-new request is required to revisit the idea. **Is that the right default, or should a rejected request be easy to "clone" into a new request with the same inputs (so the idea isn't lost, just the failed attempt)?**

## 7. What's the newsletter's actual distribution path, and when does that decision need to be made?

Already flagged as deferred to technical tool selection — content generation for the newsletter is in scope, but nothing sends it yet. **Worth confirming: is there a target platform in mind already (an existing ESP, a manual send process), or is this genuinely open?** The answer affects how much of the publish-runner pattern (queue + automated send) is worth extending to the newsletter versus leaving it as a manual step indefinitely.
