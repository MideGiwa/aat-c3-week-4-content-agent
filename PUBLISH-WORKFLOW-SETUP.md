# Publish Queue Runner — Setup Notes

**Retired 2026-09-18 — kept for history only, do not follow these steps.** User-requested: the n8n publish runner is dropped, not replaced. `publishing_queue` (populated on approval) is itself the "publish or schedule for release" deliverable now — see `DESIGN.md` §11 and its 2026-09-18 Decisions Log entry. The Discord notifications this workflow used to send now have a different, non-n8n home: `frontend/src/lib/discord.ts`, called from the pipeline itself for generation events (ready for review, pipeline failed) — see that same log entry.

Everything below describes the retired n8n workflow as it existed before this date.

This covers importing `n8n-publish-workflow.json` and connecting credentials. It publishes only to **LinkedIn and X** for now (Medium and newsletter are out of scope for this workflow — see the Decisions Log in `DESIGN.md`).

## 1. Import the workflow

In n8n: **Workflows → Import from File** → select `n8n-publish-workflow.json`. It imports inactive; leave it that way until credentials are wired up and you've run it manually once against a test row.

## 2. Database prerequisites

The workflow assumes `publishing_queue` and `channel_assets` tables already exist per `DESIGN.md`'s data model, and that `publishing_queue.status` can hold: `ready_to_publish`, `processing`, `published`, `failed`, and `stale_needs_review` (added by the hardening pass — see `EDGE-CASES-AND-GUARDRAILS.md`). `scheduled_for` is nullable — null means "publish as soon as picked up." If your schema differs, adjust the SQL in **Flag Stale Scheduled Posts**, **Claim Due Posts**, and the **Update Queue** / **Mark Invalid** nodes to match your column names.

## 3. Credentials to create

### Supabase Postgres (used by all Postgres nodes)
1. In n8n: **Credentials → New → Postgres**.
2. From your Supabase project: **Project Settings → Database → Connection string** (use the "Session pooler" or direct connection details — host, port 5432/6543, database, user, password).
3. Enable SSL if Supabase requires it (it does by default).
4. Save, then open each Postgres node in the workflow and select this credential.

### LinkedIn OAuth2
1. Create an app at the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) under your organization/page.
2. Request the **"Share on LinkedIn"** (w_member_social) product, or the organization posting product if publishing as a company page.
3. Add n8n's OAuth redirect URL (shown in the credential screen) to the app's **Authorized redirect URLs**.
4. In n8n: **Credentials → New → LinkedIn OAuth2 API**, paste the Client ID/Secret from the app, then connect and authorize.
5. Open the **Publish To LinkedIn** node and select this credential. If posting as a company page rather than a person, change `postAs` in the node's parameters to `organization` and supply the organization URN.

### X (Twitter) OAuth2
1. Create a project/app at the [X Developer Portal](https://developer.x.com/).
2. Make sure the app has **read and write** permissions and (if you're on OAuth2 user context) the `tweet.write` and `users.read` scopes enabled.
3. Add n8n's OAuth redirect URL to the app's callback URLs.
4. In n8n: **Credentials → New → X (Twitter) OAuth2 API**, paste Client ID/Secret, connect and authorize.
5. Open the **Publish To X** node and select this credential. Note: depending on your n8n version, the X node may expect OAuth1 credentials instead — if the OAuth2 credential type isn't available, use **X (Twitter) OAuth1 API** with API Key/Secret + Access Token/Secret from the same developer app instead.

### Discord Webhook (notifications)
1. In Discord: pick (or create) the channel that should receive alerts — e.g. `#content-ops-alerts`.
2. **Channel Settings → Integrations → Webhooks → New Webhook.** Name it (e.g. "Content Agent Alerts") and copy its **Webhook URL**.
3. In n8n: **Credentials → New → Discord Webhook API** (or the closest match your n8n version offers), paste the webhook URL.
4. Open each **Notify Discord (...)** node in the workflow and select this credential. There are five: Stale Flagged, Validation Failed, LinkedIn Failed, X Failed, and Repeated Failures.
5. No bot, no OAuth, no scopes — a webhook can only post into the one channel it was created for, which is all this needs.

## 4. What the workflow does

1. **Runs every 5 minutes.**
2. **Flags stale scheduled posts first.** Anything still `ready_to_publish` whose `scheduled_for` is more than 24 hours in the past (e.g. the workflow was down for a few days) gets moved to `stale_needs_review` instead of being auto-published as a backlog dump. It's pulled out of the ready pool before the claim step even runs, and if anything was flagged, one Discord message reports it (not one message per row).
3. **Atomically claims up to 20 due rows.** This uses `FOR UPDATE SKIP LOCKED` and flips claimed rows to `status = 'processing'` in the same statement it selects them — so if two executions ever overlap (one run takes longer than 5 minutes), they can never claim and publish the same row twice.
4. **Processes one row at a time**, so one failure or rate limit doesn't block the rest of the batch.
5. **Validates before touching any platform API.** Empty content, a missing channel, or content over X's 280-character limit gets marked `failed` with a specific reason (e.g. `validation: content exceeds X's 280 character limit (312 chars)`), notifies Discord, and never reaches the LinkedIn/X nodes.
6. **Routes valid rows to the matching platform node.**
7. **On success:** updates the row to `published`, stamps `published_at`, and writes a `success` row to `stage_logs`. No Discord notification on success by default — see the note below on why.
8. **On failure** (API error, rate limit, auth issue): updates the row to `failed` with the error message, writes a `failed` row to `stage_logs`, and sends a Discord alert with the specific error — nothing throws the whole execution, so one bad post doesn't stop the rest of the batch.
9. Any row with a channel other than `linkedin`/`x` is skipped (shouldn't happen given the SQL filter, but it's a safety net).
10. **After each run's batch finishes, checks for a failure pattern.** If either channel has logged 3+ failures in the last hour, a separate Discord alert fires flagging it as a likely credential/auth/rate-limit problem rather than one-off bad luck — this is what actually catches a silently-expired OAuth token instead of it failing quietly forever.

**Why no Discord ping on every successful publish:** a successful post isn't actionable — nobody needs to be paged for something that worked. Discord is kept as an alert channel (only pings when something needs a look), not a activity firehose, so it stays meaningful rather than becoming noise someone starts ignoring. If you do want a success confirmation too, it's a small addition: add a Discord node after each `Update Queue` node (mirroring the failure ones) rather than gating it behind the `Failed?` IF nodes.

## 5. Known gaps (flagged, not yet built)

- ~~Credential expiry alerting~~ — **closed.** The "Check Failure Rate" step + "Notify Discord (Repeated Failures)" node now cover this: 3+ failures on one channel within an hour triggers a Discord alert.
- **Rate-limit-aware retry.** A 429 is currently treated the same as any other failure (and would count toward the failure-rate alert above). Distinguishing "retry later" from "permanently failed" would avoid writing off a post that was just throttled, and would avoid a burst of 429s falsely triggering the credential-alert as if it were an auth problem.
- **Alert de-duplication.** The repeated-failures check re-evaluates every 5 minutes, so once a channel crosses the 3-failures-in-an-hour threshold, it'll keep alerting every tick until the failures stop or age out of the 1-hour window — there's no "only alert once per incident" suppression yet. Worth adding if it turns out to be noisy in practice.

See `EDGE-CASES-AND-GUARDRAILS.md` for the full review this came out of.

## 6. Before going live

- Run it once manually (`Execute Workflow`) against a test row with a throwaway LinkedIn/X account, and confirm the row's status updates correctly in Supabase.
- Try it against a deliberately bad row too (empty content, or 300+ characters on the `x` channel) and confirm it's marked `failed` with a validation reason instead of hitting the API — and that the Discord validation alert shows up.
- Manually trigger a failure (e.g. temporarily break the LinkedIn credential) and confirm the failure alert posts to Discord with a useful error message.
- Only then switch the workflow **Active** so the schedule trigger takes over.
- Watch `stage_logs` and your Discord channel for the first few real runs — that's your fastest signal if a credential or query needs adjusting.
