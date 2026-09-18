// Real-mode orchestrator — the Supabase-backed equivalent of
// src/lib/mock/webhooks.ts + src/lib/pipeline/run.ts combined. Only
// src/lib/webhookClient.ts calls into this file (when USE_MOCK_DATA is
// false); the mock pipeline never imports it, so nothing here can affect
// the working mock demo.
//
// Every insert/update below targets exactly the tables/columns
// supabase/schema.sql creates. The three exported functions mirror
// mock/webhooks.ts's three handlers field-for-field — their input/output
// *types* are imported from that file (type-only; erased at compile time)
// so the contract can't quietly drift between the two modes, exactly as
// that file's own header comment says: "the shapes below are the real
// contract."
//
// Concurrency note: the mock store fakes the "first decision wins"
// guarantee for review_decisions with a find-then-refuse check, because it
// has no real database to lean on. This file doesn't need that trick — the
// UNIQUE constraint on review_decisions.draft_id (schema.sql) is the actual
// guard. Two concurrent approve/reject calls both attempt the insert, and
// Postgres guarantees only one can succeed; the loser's unique-violation
// (error code 23505) is what "already_decided" below is built from.
//
// Running against a real Supabase project and real AI/search APIs since
// 2026-09-18 (see README.md "Going from mock to real" for setup steps, and
// DESIGN.md's decisions log for the live issues found and fixed since).

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { getSupabaseServerClient } from "./server";
import { notifyDiscord } from "../discord";
import { isFutureDateTime, validateNewRequest, type NewRequestInput } from "../validation";
import type { ActivityAction, Channel, ContentRequest, Draft, Evaluation, SourceRef } from "../types";
import {
  evaluateDraft,
  generateDraft,
  planTitleOptions,
  prepareChannelAssets,
  researchAndCurateSources,
  reviseDraft,
  type ScrapeFailure,
} from "../pipeline/generate.real";
import type {
  ContentRequestWebhookResult,
  ManageAttachmentInput,
  ManageAttachmentResult,
  ManualEditInput,
  ManualEditResult,
  ReviewActionInput,
  ReviewActionWebhookResult,
  RetryRequestInput,
  RetryRequestResult,
  RetryRevisionInput,
  RetryRevisionResult,
} from "../mock/webhooks";

const MAX_AUTO_REVISION_ROUNDS = 1; // matches pipeline/run.ts's mock counterpart

// The shape a `requests` row comes back as directly from Supabase — a
// narrower cousin of data.ts's RequestRow (this file doesn't need
// reviewer_ids, since none of the logic below reads them).
interface RequestRow {
  id: string;
  idea_or_topic: string;
  target_audience: string;
  source_url: string | null;
  tone: string;
  priority_channels: string[] | null;
  publish_timing: ContentRequest["publish_timing"];
  scheduled_for: string | null;
  title_options: string[] | null;
  chosen_title_index: 0 | 1 | null;
  title_option_reason: string | null;
  chosen_draft_id: string | null;
  custom_rubric_criteria: ContentRequest["custom_rubric_criteria"] | null;
  status: ContentRequest["status"];
  failure_reason: string | null;
  submitted_by: string;
  created_at: string;
  updated_at: string;
}

function rowToContentRequest(row: RequestRow): ContentRequest {
  return {
    id: row.id,
    idea_or_topic: row.idea_or_topic,
    target_audience: row.target_audience,
    source_url: row.source_url,
    tone: row.tone,
    priority_channels: (row.priority_channels ?? []) as Channel[],
    publish_timing: row.publish_timing,
    scheduled_for: row.scheduled_for,
    title_options: (row.title_options as [string, string] | null) ?? null,
    chosen_title_index: row.chosen_title_index,
    title_option_reason: row.title_option_reason,
    chosen_draft_id: row.chosen_draft_id ?? null,
    custom_rubric_criteria: row.custom_rubric_criteria ?? [],
    status: row.status,
    failure_reason: row.failure_reason,
    submitted_by: row.submitted_by,
    reviewer_ids: [], // not fetched here — nothing in this file needs it
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getProfileName(supabase: SupabaseClient, profileId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("name").eq("id", profileId).maybeSingle();
  if (error) throw error;
  return data?.name ?? "Unknown";
}

async function logActivity(
  supabase: SupabaseClient,
  requestId: string,
  actorType: "system" | "human",
  actorId: string | null,
  actorName: string,
  action: ActivityAction,
  target: string | null,
  notes: string | null
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    id: randomUUID(),
    request_id: requestId,
    actor_type: actorType,
    actor_id: actorId,
    actor_name: actorName,
    action,
    target,
    notes,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Machine-facing telemetry, not the human-facing activity_log — purely for
// measuring how often research runs into a source it can't scrape, and why
// (see generate.real.ts's ScrapeFailure/KNOWN_UNSUPPORTED_DOMAINS doc
// comments, and DESIGN.md's 2026-09-18 decisions log). Writes into
// stage_logs, an existing-but-previously-unused table in schema.sql built
// for exactly this ("machine-facing debug"). Best-effort: a failure here
// shouldn't take down the pipeline run that's actually delivering the
// request, so errors are logged and swallowed rather than thrown.
async function logScrapeFailures(
  supabase: SupabaseClient,
  requestId: string,
  failures: ScrapeFailure[]
): Promise<void> {
  const { error } = await supabase.from("stage_logs").insert(
    failures.map((f) => ({
      id: randomUUID(),
      request_id: requestId,
      stage: "research_scrape",
      status: f.reason,
      error_message: `${f.url}: ${f.detail}`,
      created_at: new Date().toISOString(),
    }))
  );
  if (error) {
    console.error(`Failed to log scrape failures to stage_logs for request ${requestId}: ${error.message}`);
  }
}

async function insertDraft(supabase: SupabaseClient, draft: Draft): Promise<void> {
  const { error } = await supabase.from("drafts").insert({
    id: draft.id,
    request_id: draft.request_id,
    version: draft.version,
    option_label: draft.option_label,
    title: draft.title,
    sections: draft.sections,
    generated_by: draft.generated_by,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  });
  if (error) throw error;
}

async function insertEvaluation(supabase: SupabaseClient, evaluation: Evaluation): Promise<void> {
  const { error } = await supabase.from("evaluations").insert({
    id: evaluation.id,
    draft_id: evaluation.draft_id,
    round: evaluation.round,
    status: evaluation.status,
    scores: evaluation.scores,
    unsupported_claims: evaluation.unsupported_claims,
    sections_needing_revision: evaluation.sections_needing_revision,
    created_at: evaluation.created_at,
  });
  if (error) throw error;
}

/** Generates and inserts channel copy for a newly-created draft. Channel
 * assets are keyed by draft_id (schema.sql), and — as of the 2026-09-18
 * angle-switching fix — never deleted: an old version's copy just stops
 * being "active" once request.chosen_draft_id moves on, same as the draft
 * rows themselves. Used for both a targeted revision and an angle switch
 * that has to regenerate (no prior draft existed under that option) —
 * runInitialPipeline inlines the equivalent for the very first draft. */
async function insertChannelAssetsForDraft(supabase: SupabaseClient, request: ContentRequest, draft: Draft): Promise<void> {
  const channelAssets = await prepareChannelAssets(request, draft);
  const { error: insertError } = await supabase.from("channel_assets").insert(
    channelAssets.map((c) => ({
      id: c.id,
      request_id: c.request_id,
      draft_id: c.draft_id,
      channel: c.channel,
      content: c.content,
      status: c.status,
    }))
  );
  if (insertError) throw insertError;

  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "prepare_channel_assets",
    draft.id,
    `Prepared copy for: ${channelAssets.map((c) => c.channel).join(", ")}.`
  );
}

/** Draft → evaluate → (if flagged) revise once → evaluate again, against
 * real Claude calls and real persistence — the async, Supabase-backed
 * counterpart to pipeline/run.ts's generateDraftWithAutoRevision. Draft
 * versions are numbered continuously per request (queried fresh from the
 * table, same "next = max + 1" logic the mock uses over its in-memory
 * array) so VersionHistory shows one linear timeline regardless of which
 * path produced each entry. */
async function generateDraftWithAutoRevision(
  supabase: SupabaseClient,
  request: ContentRequest,
  sources: SourceRef[],
  title: string,
  optionLabel: string
): Promise<Draft> {
  const { data: existingVersions, error: versionError } = await supabase
    .from("drafts")
    .select("version")
    .eq("request_id", request.id);
  if (versionError) throw versionError;
  const nextVersion = Math.max(0, ...(existingVersions ?? []).map((d) => d.version)) + 1;

  let draft = await generateDraft(request, sources, title, nextVersion, "system_initial", optionLabel);
  await insertDraft(supabase, draft);

  let evaluation = await evaluateDraft(request, draft, sources, 1);
  await insertEvaluation(supabase, evaluation);
  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "evaluate_draft",
    draft.id,
    `Round 1: ${evaluation.status}.${evaluation.unsupported_claims.length > 0 ? ` Flagged: ${evaluation.unsupported_claims.join(" ")}` : ""}`
  );

  let round = 1;
  while (evaluation.status !== "pass" && round <= MAX_AUTO_REVISION_ROUNDS) {
    const revised = await reviseDraft(draft, sources, evaluation, "system_revision");
    await insertDraft(supabase, revised);
    await logActivity(
      supabase,
      request.id,
      "system",
      null,
      "System",
      "regenerate_draft",
      revised.id,
      `Automatic revision after round ${round} evaluation flagged: ${evaluation.sections_needing_revision.join(", ")}.`
    );

    round += 1;
    draft = revised;
    evaluation = await evaluateDraft(request, draft, sources, round);
    await insertEvaluation(supabase, evaluation);
    await logActivity(supabase, request.id, "system", null, "System", "evaluate_draft", draft.id, `Round ${round}: ${evaluation.status}.`);
  }

  return draft;
}

/** Sets a request to research_failed and logs why — the real counterpart
 * to the research_failed trigger EDGE-CASES-AND-GUARDRAILS.md describes
 * (mock mode never simulates this path; generate.real.ts's
 * researchAndCurateSources is what can actually return zero sources here,
 * e.g. every candidate URL failed to scrape). Also used as the generic
 * catch-all for any later pipeline step failing (drafting, evaluation,
 * channel prep) — there's no separate status for those today, so the
 * reason string says which stage actually failed rather than implying it
 * was research specifically every time. Notifies Discord either way. */
async function failResearch(
  supabase: SupabaseClient,
  request: ContentRequest,
  reason: string,
  requestUrl?: string
): Promise<void> {
  request.status = "research_failed";
  request.failure_reason = reason;
  request.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("requests")
    .update({ status: request.status, failure_reason: reason, updated_at: request.updated_at })
    .eq("id", request.id);
  if (error) throw error;

  await logActivity(supabase, request.id, "system", null, "System", "complete_research", null, `Research failed: ${reason}`);

  await notifyDiscord(
    `⚠️ **${request.idea_or_topic}** failed during generation: ${reason}` +
      (requestUrl ? `\n${requestUrl}` : "")
  );
}

/** Records that the automatic revision after a "request changes" decision
 * failed, WITHOUT moving the request out of `needs_manual_revision` — a
 * human already asked for changes and still needs to see them applied, and
 * there's no better status to fall back to (unlike a brand-new request,
 * this one already has a reviewable draft sitting there). Surfaced on the
 * request detail page as a failure banner (2026-09-18 fix, alongside the
 * "why does this need revision" banner) and stops PipelineProgress's poll
 * (its `stalled` prop). A reviewer can just click "Request Changes" again
 * to retry — that re-attempts against the same, still-unrevised draft. */
async function recordRevisionFailure(
  supabase: SupabaseClient,
  request: ContentRequest,
  reason: string,
  requestUrl?: string
): Promise<void> {
  request.failure_reason = reason;
  request.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("requests")
    .update({ failure_reason: reason, updated_at: request.updated_at })
    .eq("id", request.id);
  if (error) throw error;

  await logActivity(supabase, request.id, "system", null, "System", "revision_failed", null, reason);

  await notifyDiscord(
    `⚠️ **${request.idea_or_topic}** — automatic revision failed: ${reason}` +
      (requestUrl ? `\n${requestUrl}` : "")
  );
}

/** Runs the full automated pipeline for a freshly-submitted request,
 * mutating `request` in place and persisting every step to Supabase — the
 * real-mode counterpart to pipeline/run.ts's runInitialPipeline. Genuinely
 * calls Firecrawl, Tavily, Claude, and Voyage AI in sequence, so (unlike
 * the mock, which is instant) this can realistically take low tens of
 * seconds to a couple of minutes. Callers don't await this on the request
 * path — see handleContentRequestWebhook's use of waitUntil() — so any
 * error thrown out of here needs to be caught by the caller and turned
 * into a failed status; nothing else will surface it to the user.
 * `requestUrl`, when given, is included in the Discord notification so
 * whoever's on call can jump straight to the request. */
async function runInitialPipeline(supabase: SupabaseClient, request: ContentRequest, requestUrl?: string): Promise<void> {
  let researchResult: Awaited<ReturnType<typeof researchAndCurateSources>>;
  try {
    researchResult = await researchAndCurateSources(request);
  } catch (err) {
    await failResearch(supabase, request, `Research step failed: ${String(err)}`, requestUrl);
    return;
  }

  const { sources, chunks, scrapeFailures, failedSources } = researchResult;
  if (scrapeFailures.length > 0) {
    await logScrapeFailures(supabase, request.id, scrapeFailures);
  }

  // Insert failed-candidate stub rows before the empty-sources check below
  // — a reviewer should be able to see exactly which URLs were tried and
  // why they didn't make it even in the total-failure case (every
  // candidate blocked/paywalled/dead), where the request lands on
  // research_failed and never reaches a draft at all. These are always
  // selected: false and carry no raw_text, so they can never be cited from
  // or mistaken for a real source (2026-09-18, see researchAndCurateSources'
  // doc comment).
  if (failedSources.length > 0) {
    const { error: failedSourcesError } = await supabase.from("sources").insert(
      failedSources.map((s) => ({
        id: s.id,
        request_id: s.request_id,
        url: s.url,
        title: s.title,
        raw_text: null,
        retrieved_at: s.retrieved_at,
        selected: false,
        relevance_note: s.relevance_note,
      }))
    );
    if (failedSourcesError) throw failedSourcesError;
  }

  if (sources.length === 0) {
    await failResearch(
      supabase,
      request,
      "No usable sources could be retrieved — every candidate URL failed to scrape, or none were found.",
      requestUrl
    );
    return;
  }

  const { error: sourcesError } = await supabase.from("sources").insert(
    sources.map((s) => ({
      id: s.id,
      request_id: s.request_id,
      url: s.url,
      title: s.title,
      raw_text: s.raw_text ?? null,
      retrieved_at: s.retrieved_at,
      selected: s.selected,
      relevance_note: s.relevance_note,
    }))
  );
  if (sourcesError) throw sourcesError;

  if (chunks.length > 0) {
    const { error: chunksError } = await supabase.from("source_chunks").insert(
      chunks.map((c) => ({
        id: c.id,
        source_id: c.source_id,
        chunk_index: c.chunk_index,
        chunk_text: c.chunk_text,
        embedding: c.embedding,
      }))
    );
    if (chunksError) throw chunksError;
  }

  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "complete_research",
    null,
    `Retrieved ${sources.length} source(s); ${sources.filter((s) => s.selected).length} selected as relevant, ${sources.filter((s) => !s.selected).length} rejected below the relevance floor.`
  );

  const { options, chosenIndex, reason } = await planTitleOptions(request);
  const chosenTitle = options[chosenIndex];
  request.title_options = options;
  request.chosen_title_index = chosenIndex;
  request.title_option_reason = reason;

  const { error: planError } = await supabase
    .from("requests")
    .update({
      title_options: options,
      chosen_title_index: chosenIndex,
      title_option_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id);
  if (planError) throw planError;

  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "select_option",
    null,
    `Considered 2 title/angle options ("${options[0]}" vs. "${options[1]}"); selected "${chosenTitle}" — ${reason}`
  );

  const optionLabel = chosenIndex === 0 ? "A" : "B";
  const draft = await generateDraftWithAutoRevision(supabase, request, sources, chosenTitle, optionLabel);
  request.chosen_draft_id = draft.id;

  const channelAssets = await prepareChannelAssets(request, draft);
  const { error: channelError } = await supabase.from("channel_assets").insert(
    channelAssets.map((c) => ({
      id: c.id,
      request_id: c.request_id,
      draft_id: c.draft_id,
      channel: c.channel,
      content: c.content,
      status: c.status,
    }))
  );
  if (channelError) throw channelError;

  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "prepare_channel_assets",
    draft.id,
    `Prepared copy for: ${channelAssets.map((c) => c.channel).join(", ")}.`
  );

  request.status = "pending_human_review";
  request.updated_at = new Date().toISOString();
  const { error: statusError } = await supabase
    .from("requests")
    .update({ status: request.status, chosen_draft_id: request.chosen_draft_id, updated_at: request.updated_at })
    .eq("id", request.id);
  if (statusError) throw statusError;

  await notifyDiscord(
    `✅ **${chosenTitle}** is drafted and ready for review.` + (requestUrl ? `\n${requestUrl}` : "")
  );
}

/** Lets a reviewer override the pipeline's automatic angle pick (PRD:
 * "...or select content") — real-mode counterpart to
 * pipeline/run.ts's runSelectOptionPipeline. Per the 2026-09-18 UI revision
 * (DESIGN.md decisions log): switching to an angle that already has a
 * generated draft does NOT regenerate anything — it repoints
 * request.chosen_draft_id at the existing (highest-version) draft under
 * that option_label, with no new draft row and no AI call. Only an angle
 * that's never been drafted for this request triggers the
 * evaluate/auto-revise generation loop. The human-attributed `select_option`
 * activity entry (who switched it and why) is logged by the caller
 * (handleReviewActionWebhook), before this runs; this function only decides
 * reuse-vs-regenerate and does whichever one applies. */
async function runSelectOptionPipeline(supabase: SupabaseClient, request: ContentRequest, newIndex: 0 | 1): Promise<void> {
  if (!request.title_options) return;
  const newTitle = request.title_options[newIndex];
  const newLabel = newIndex === 0 ? "A" : "B";

  const { data: existingDraftRows, error: existingDraftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("request_id", request.id)
    .eq("option_label", newLabel)
    .order("version", { ascending: false })
    .limit(1);
  if (existingDraftError) throw existingDraftError;
  const existingDraft = (existingDraftRows?.[0] as Draft | undefined) ?? null;

  request.chosen_title_index = newIndex;

  if (existingDraft) {
    request.chosen_draft_id = existingDraft.id;
    await logActivity(
      supabase,
      request.id,
      "system",
      null,
      "System",
      "switch_to_existing_draft",
      existingDraft.id,
      `Switched back to v${existingDraft.version} (previously generated for this option) — no regeneration needed.`
    );
  } else {
    const { data: sourceRows, error: sourceError } = await supabase.from("sources").select("*").eq("request_id", request.id);
    if (sourceError) throw sourceError;
    const sources = (sourceRows ?? []) as SourceRef[];

    const draft = await generateDraftWithAutoRevision(supabase, request, sources, newTitle, newLabel);
    request.chosen_draft_id = draft.id;
    await insertChannelAssetsForDraft(supabase, request, draft);
  }

  request.status = "pending_human_review";
  request.updated_at = new Date().toISOString();
  const { error: statusError } = await supabase
    .from("requests")
    .update({
      status: request.status,
      chosen_title_index: request.chosen_title_index,
      chosen_draft_id: request.chosen_draft_id,
      updated_at: request.updated_at,
    })
    .eq("id", request.id);
  if (statusError) throw statusError;
}

/** Runs a targeted revision after a reviewer requests changes — real-mode
 * counterpart to pipeline/run.ts's runRevisionPipeline. Resolves
 * synchronously back to pending_human_review with the new version ready,
 * same rationale as that function's doc comment (CONTENT-PIPELINE-SPEC.md
 * §7). */
async function runRevisionPipeline(
  supabase: SupabaseClient,
  request: ContentRequest,
  latestDraft: Draft,
  reviewerNotes: string | null
): Promise<void> {
  const { data: sourceRows, error: sourceError } = await supabase.from("sources").select("*").eq("request_id", request.id);
  if (sourceError) throw sourceError;
  const sources = (sourceRows ?? []) as SourceRef[];

  const { data: evalRows, error: evalError } = await supabase
    .from("evaluations")
    .select("*")
    .eq("draft_id", latestDraft.id)
    .order("round", { ascending: false });
  if (evalError) throw evalError;
  const priorEvaluations = (evalRows ?? []) as Evaluation[];
  const latestEvaluation = priorEvaluations[0] ?? (await evaluateDraft(request, latestDraft, sources, 1));
  const maxRound = Math.max(0, ...priorEvaluations.map((e) => e.round));

  // If the AI evaluation had nothing flagged (a human is requesting changes
  // for reasons the rubric didn't catch), still revise something concrete —
  // same fallback the mock uses.
  const evaluationForRevision =
    latestEvaluation.sections_needing_revision.length > 0
      ? latestEvaluation
      : { ...latestEvaluation, sections_needing_revision: [latestDraft.sections[0]?.heading].filter(Boolean) as string[] };

  const revised = await reviseDraft(latestDraft, sources, evaluationForRevision, "human_requested", reviewerNotes);
  await insertDraft(supabase, revised);
  request.chosen_draft_id = revised.id;
  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "regenerate_draft",
    revised.id,
    `Regenerated following reviewer-requested changes${reviewerNotes ? `: "${reviewerNotes}"` : "."}`
  );

  const newEvaluation = await evaluateDraft(request, revised, sources, maxRound + 1);
  await insertEvaluation(supabase, newEvaluation);
  await logActivity(
    supabase,
    request.id,
    "system",
    null,
    "System",
    "evaluate_draft",
    revised.id,
    `Round ${newEvaluation.round}: ${newEvaluation.status}.`
  );

  await insertChannelAssetsForDraft(supabase, request, revised);

  request.status = "pending_human_review";
  request.updated_at = new Date().toISOString();
  const { error: statusError } = await supabase
    .from("requests")
    .update({ status: request.status, chosen_draft_id: request.chosen_draft_id, updated_at: request.updated_at })
    .eq("id", request.id);
  if (statusError) throw statusError;
}

/** Promotes this request's channel-specific copy from "draft" to
 * "ready_to_publish", and — unlike the mock, which stops there — also
 * inserts the matching publishing_queue row, since that's the table
 * n8n-publish-workflow.json's "Claim Due Posts" query actually reads from
 * in real mode (schema.sql's comment above that table). Newsletter rows are
 * promoted the same way as the others for consistency, same "generated but
 * not auto-published" scope as mock mode (DESIGN.md §11). */
async function promoteChannelAssetsToReadyToPublish(
  supabase: SupabaseClient,
  request: ContentRequest,
  draftId: string
): Promise<void> {
  const { data: draftAssets, error: fetchError } = await supabase
    .from("channel_assets")
    .select("id")
    .eq("request_id", request.id)
    .eq("draft_id", draftId)
    .eq("status", "draft");
  if (fetchError) throw fetchError;

  const assetIds = (draftAssets ?? []).map((a) => a.id as string);
  if (assetIds.length === 0) return;

  const { error: updateError } = await supabase.from("channel_assets").update({ status: "ready_to_publish" }).in("id", assetIds);
  if (updateError) throw updateError;

  const scheduledFor = request.publish_timing === "scheduled" ? request.scheduled_for : null;
  const { error: queueError } = await supabase.from("publishing_queue").insert(
    assetIds.map((channel_asset_id) => ({
      id: randomUUID(),
      channel_asset_id,
      status: "ready_to_publish",
      scheduled_for: scheduledFor,
    }))
  );
  if (queueError) throw queueError;
}

// ============================================================
// Exported handlers — same three shapes as src/lib/mock/webhooks.ts
// ============================================================

export async function handleContentRequestWebhook(
  input: NewRequestInput & { submitted_by: string; reviewer_ids: string[]; origin?: string }
): Promise<ContentRequestWebhookResult> {
  // Re-validated here exactly as the mock does, regardless of what the
  // browser's form already checked (INTAKE-AND-RESEARCH-SPEC.md §1).
  const errors = validateNewRequest(input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  const requestId = randomUUID();

  const newRequest: ContentRequest = {
    id: requestId,
    idea_or_topic: input.idea_or_topic.trim(),
    target_audience: input.target_audience.trim(),
    source_url: input.source_url || null,
    tone: input.tone || "professional",
    priority_channels: (input.priority_channels as Channel[]) ?? ["linkedin", "x", "newsletter"],
    // Publish timing is decided at approval, not intake — see
    // mock/webhooks.ts's matching comment. Left null here regardless of
    // what the form sends (fixed 2026-09-18 — this used to default to
    // "immediately" at intake, making every unreviewed request look
    // already decided).
    publish_timing: null,
    scheduled_for: null,
    title_options: null,
    chosen_title_index: null,
    title_option_reason: null,
    chosen_draft_id: null,
    custom_rubric_criteria: (input.custom_rubric_criteria ?? []).map((c) => ({
      name: c.name.trim(),
      description: c.description.trim(),
    })),
    status: "intake_complete",
    failure_reason: null,
    submitted_by: input.submitted_by,
    reviewer_ids: input.reviewer_ids,
    created_at: now,
    updated_at: now,
  };

  const { error: insertError } = await supabase.from("requests").insert({
    id: newRequest.id,
    idea_or_topic: newRequest.idea_or_topic,
    target_audience: newRequest.target_audience,
    source_url: newRequest.source_url,
    tone: newRequest.tone,
    priority_channels: newRequest.priority_channels,
    publish_timing: newRequest.publish_timing,
    scheduled_for: newRequest.scheduled_for,
    custom_rubric_criteria: newRequest.custom_rubric_criteria,
    status: newRequest.status,
    submitted_by: newRequest.submitted_by,
    created_at: newRequest.created_at,
    updated_at: newRequest.updated_at,
  });
  if (insertError) throw insertError;

  if (newRequest.reviewer_ids.length > 0) {
    const { error: reviewerError } = await supabase
      .from("request_reviewers")
      .insert(newRequest.reviewer_ids.map((reviewer_id) => ({ request_id: requestId, reviewer_id })));
    if (reviewerError) throw reviewerError;
  }

  const submitterName = await getProfileName(supabase, input.submitted_by);
  await logActivity(supabase, requestId, "human", input.submitted_by, submitterName, "submit_request", null, null);

  // Everything up to here is fast (a handful of inserts) — respond to the
  // browser now instead of making it wait through Research & Retrieval
  // through Channel Prep too, which genuinely takes low tens of seconds to
  // a couple of minutes against real Firecrawl/Tavily/Claude/Voyage calls.
  // waitUntil keeps this function alive to finish that work after the
  // response is sent (see this route's `maxDuration`), rather than the
  // pipeline racing the response and getting killed mid-run. The request
  // stays at `intake_complete` until the pipeline moves it along —
  // /requests/[id]'s PipelineProgress component polls for that.
  const requestUrl = input.origin ? `${input.origin}/requests/${requestId}` : undefined;
  waitUntil(
    runInitialPipeline(supabase, newRequest, requestUrl).catch((err) =>
      failResearch(supabase, newRequest, `Pipeline failed unexpectedly: ${String(err)}`, requestUrl)
    )
  );

  return { ok: true, request_id: requestId, status: newRequest.status };
}

export async function handleReviewActionWebhook(
  input: ReviewActionInput & { origin?: string }
): Promise<ReviewActionWebhookResult> {
  const supabase = getSupabaseServerClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("*")
    .eq("id", input.request_id)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!requestRow) return { ok: false, reason: "not_found" };

  const request = rowToContentRequest(requestRow as RequestRow);
  const requestUrl = input.origin ? `${input.origin}/requests/${request.id}` : undefined;

  // Same stale-draft guard as the mock — acting on a draft that isn't the
  // ACTIVE one (request.chosen_draft_id, not just "highest version number"
  // since the 2026-09-18 angle-switching fix) is refused rather than
  // silently applied to old or inactive content.
  const currentDraft = request.chosen_draft_id ? { id: request.chosen_draft_id } : null;

  if (input.action !== "select_option" && currentDraft && currentDraft.id !== input.draft_id) {
    return { ok: false, reason: "stale_draft", current_draft_id: currentDraft.id };
  }

  // Approve is where publish timing is decided (see
  // handleContentRequestWebhook) — validated here the same way intake used
  // to validate it.
  if (input.action === "approve" && input.publish_timing === "scheduled") {
    if (!input.scheduled_for || !isFutureDateTime(input.scheduled_for)) {
      return {
        ok: false,
        reason: "invalid_schedule",
        message: "Pick a future date and time, or choose 'publish immediately'.",
      };
    }
  }

  const now = new Date().toISOString();

  if (input.action === "approve" || input.action === "reject" || input.action === "request_changes") {
    // The UNIQUE constraint on review_decisions.draft_id is the real race
    // guard (see this file's header comment) — attempt the insert, and
    // treat a unique-violation (23505) as "someone else already decided."
    const { error: decisionError } = await supabase.from("review_decisions").insert({
      id: randomUUID(),
      draft_id: input.draft_id,
      action: input.action,
      reviewer_id: input.reviewer_id,
      notes: input.notes ?? null,
      decided_at: now,
    });
    if (decisionError) {
      if (decisionError.code === "23505") {
        const { data: existing, error: existingError } = await supabase
          .from("review_decisions")
          .select("action, reviewer_id")
          .eq("draft_id", input.draft_id)
          .maybeSingle();
        if (existingError) throw existingError;
        const decidedBy = existing ? await getProfileName(supabase, existing.reviewer_id) : "another reviewer";
        return {
          ok: false,
          reason: "already_decided",
          decided_by: decidedBy,
          decided_action: existing?.action ?? "unknown",
        };
      }
      throw decisionError;
    }
  }

  let newStatus: ContentRequest["status"] = request.status;
  if (input.action === "approve") newStatus = "approved";
  else if (input.action === "reject") newStatus = "rejected_by_human";
  else if (input.action === "request_changes") newStatus = "needs_manual_revision";

  request.status = newStatus;
  request.updated_at = now;

  const requestUpdate: Record<string, unknown> = { status: newStatus, updated_at: now };
  if (input.action === "approve") {
    request.publish_timing = input.publish_timing ?? "immediately";
    request.scheduled_for = input.publish_timing === "scheduled" ? input.scheduled_for ?? null : null;
    requestUpdate.publish_timing = request.publish_timing;
    requestUpdate.scheduled_for = request.scheduled_for;
  }
  if (input.action === "request_changes") {
    // Clears out any failure_reason left over from a previous automatic
    // revision that failed (see recordRevisionFailure below) — this is a
    // fresh attempt, so a stale failure message shouldn't linger on the
    // detail page once it's underway again.
    request.failure_reason = null;
    requestUpdate.failure_reason = null;
  }

  const { error: requestUpdateError } = await supabase.from("requests").update(requestUpdate).eq("id", request.id);
  if (requestUpdateError) throw requestUpdateError;

  const reviewerName = await getProfileName(supabase, input.reviewer_id);

  // select_option's own activity note is built here (not passed through
  // from the client) so it always reflects the actual title swap.
  let activityNotes = input.notes ?? null;
  if (input.action === "select_option" && request.title_options) {
    const idx = input.selected_option_label === "B" ? 1 : 0;
    const previousIdx = request.chosen_title_index ?? 0;
    activityNotes =
      idx === previousIdx
        ? `Kept option ${input.selected_option_label ?? "A"}: "${request.title_options[idx]}".`
        : `Switched to option ${input.selected_option_label ?? "A"}: "${request.title_options[idx]}" — overriding the earlier pick ("${request.title_options[previousIdx]}").`;
  }

  await logActivity(
    supabase,
    input.request_id,
    "human",
    input.reviewer_id,
    reviewerName,
    input.action,
    input.action === "select_option" ? null : input.draft_id,
    activityNotes
  );

  if (input.action === "approve") {
    await promoteChannelAssetsToReadyToPublish(supabase, request, input.draft_id);
  } else if (input.action === "request_changes") {
    const { data: draftRow, error: draftFetchError } = await supabase.from("drafts").select("*").eq("id", input.draft_id).maybeSingle();
    if (draftFetchError) throw draftFetchError;
    if (draftRow) {
      // Real Claude calls (revise + evaluate, sequential) can take anywhere
      // from a few seconds to well past what this route's response should
      // make a reviewer wait on — don't block the response on it (2026-09-18
      // fix: this used to `await` the whole pipeline inline, with no
      // maxDuration set on the route at all, so a slow revision could get
      // killed mid-flight by the platform's default timeout. The request
      // was already committed to `needs_manual_revision` above by that
      // point, but the client's fetch would error out or hang with nothing
      // to show for it — the reviewer only saw the outcome after manually
      // reloading later, once the server-side work had actually finished).
      // Same "commit the fast state change, finish slow work via waitUntil"
      // pattern as handleContentRequestWebhook/handleRetryRequestWebhook —
      // PipelineProgress polls while status is `needs_manual_revision` and
      // stops (showing the failure instead) once failure_reason is set.
      waitUntil(
        runRevisionPipeline(supabase, request, draftRow as Draft, input.notes ?? null).catch((err) =>
          recordRevisionFailure(supabase, request, `Automatic revision failed: ${String(err)}`, requestUrl)
        )
      );
    }
    // newStatus stays "needs_manual_revision" — the response reflects the
    // fast state change above, not the pipeline's eventual outcome.
  } else if (input.action === "select_option" && request.title_options) {
    const idx: 0 | 1 = input.selected_option_label === "B" ? 1 : 0;
    if (idx !== request.chosen_title_index) {
      await runSelectOptionPipeline(supabase, request, idx);
      newStatus = request.status;
    }
  }

  return { ok: true, new_status: newStatus };
}

export async function handleManageAttachmentWebhook(input: ManageAttachmentInput): Promise<ManageAttachmentResult> {
  const supabase = getSupabaseServerClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("id, status, submitted_by")
    .eq("id", input.request_id)
    .maybeSingle();
  if (requestError) throw requestError;

  const { data: attachmentRow, error: attachmentError } = await supabase
    .from("request_attachments")
    .select("id")
    .eq("id", input.attachment_id)
    .maybeSingle();
  if (attachmentError) throw attachmentError;

  if (!requestRow || !attachmentRow) return { ok: false, reason: "not_found" };

  // DESIGN.md §14: editable/removable only before Research & Retrieval has
  // consumed it.
  if (requestRow.status !== "intake_complete") {
    return { ok: false, reason: "already_consumed_by_research" };
  }

  const now = new Date().toISOString();

  if (input.action === "remove") {
    const { error: updateError } = await supabase
      .from("request_attachments")
      .update({ status: "removed", removed_at: now })
      .eq("id", input.attachment_id);
    if (updateError) throw updateError;
  }

  const submitterName = await getProfileName(supabase, requestRow.submitted_by);
  await logActivity(supabase, input.request_id, "human", requestRow.submitted_by, submitterName, "remove_attachment", input.attachment_id, null);

  return { ok: true };
}

// Real-mode counterpart to mock/webhooks.ts's handleRetryRequestWebhook —
// see that function's doc comment for why a retry clears prior
// sources/drafts (and, via schema.sql's `on delete cascade`, their
// source_chunks/evaluations/channel_assets/review_decisions/
// publishing_queue rows) before re-running the pipeline from scratch,
// rather than trying to resume mid-stage.
export async function handleRetryRequestWebhook(
  input: RetryRequestInput & { origin?: string }
): Promise<RetryRequestResult> {
  const supabase = getSupabaseServerClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("*")
    .eq("id", input.request_id)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!requestRow) return { ok: false, reason: "not_found" };

  const request = rowToContentRequest(requestRow as RequestRow);
  if (request.status !== "research_failed") return { ok: false, reason: "not_failed" };

  const { error: deleteSourcesError } = await supabase.from("sources").delete().eq("request_id", request.id);
  if (deleteSourcesError) throw deleteSourcesError;
  const { error: deleteDraftsError } = await supabase.from("drafts").delete().eq("request_id", request.id);
  if (deleteDraftsError) throw deleteDraftsError;

  request.status = "intake_complete";
  request.failure_reason = null;
  request.title_options = null;
  request.chosen_title_index = null;
  request.title_option_reason = null;
  request.chosen_draft_id = null;
  // A request retried here never made it to approval, so publish_timing
  // shouldn't carry a real value — this also self-heals any row still
  // stuck with the old "immediately"-at-intake default (fixed 2026-09-18).
  request.publish_timing = null;
  request.scheduled_for = null;
  request.updated_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("requests")
    .update({
      status: request.status,
      failure_reason: null,
      title_options: null,
      chosen_title_index: null,
      title_option_reason: null,
      chosen_draft_id: null,
      publish_timing: null,
      scheduled_for: null,
      updated_at: request.updated_at,
    })
    .eq("id", request.id);
  if (updateError) throw updateError;

  const retrierName = await getProfileName(supabase, input.retried_by);
  await logActivity(supabase, request.id, "human", input.retried_by, retrierName, "retry_pipeline", null, null);

  // Same fast-response/background-work split as the initial submission —
  // see handleContentRequestWebhook's matching comment.
  const requestUrl = input.origin ? `${input.origin}/requests/${request.id}` : undefined;
  waitUntil(
    runInitialPipeline(supabase, request, requestUrl).catch((err) =>
      failResearch(supabase, request, `Pipeline failed unexpectedly: ${String(err)}`, requestUrl)
    )
  );

  return { ok: true, status: request.status };
}

// Real-mode counterpart to mock/webhooks.ts's handleManualEditWebhook — the
// "inline edit, but versioned" feature (DESIGN.md decisions log,
// 2026-09-18). Purely a text substitution: no AI call, no re-evaluation, no
// channel-copy regeneration. Locked the same way approve/reject/
// request_changes are — once a decision exists for the active draft, this
// refuses rather than quietly rewriting content a reviewer already decided
// on.
export async function handleManualEditWebhook(input: ManualEditInput): Promise<ManualEditResult> {
  const supabase = getSupabaseServerClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("*")
    .eq("id", input.request_id)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!requestRow) return { ok: false, reason: "not_found" };
  const request = rowToContentRequest(requestRow as RequestRow);

  if (!request.chosen_draft_id) return { ok: false, reason: "not_found" };
  if (request.chosen_draft_id !== input.draft_id) return { ok: false, reason: "stale_draft" };

  const { data: draftRow, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", request.chosen_draft_id)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draftRow) return { ok: false, reason: "not_found" };
  const activeDraft = draftRow as Draft;

  const { data: existingDecision, error: decisionError } = await supabase
    .from("review_decisions")
    .select("id")
    .eq("draft_id", activeDraft.id)
    .maybeSingle();
  if (decisionError) throw decisionError;
  if (existingDecision) return { ok: false, reason: "locked" };

  if (input.section_index < 0 || input.section_index >= activeDraft.sections.length) {
    return { ok: false, reason: "invalid_section" };
  }

  const editedHeading = activeDraft.sections[input.section_index].heading;
  const sections = activeDraft.sections.map((s, idx) =>
    idx === input.section_index ? { ...s, body: input.new_body } : s
  );
  const now = new Date().toISOString();

  // Version behavior (reworked 2026-09-18 — user feedback: "if 50 changes
  // are made that is 50 new versions"): only the FIRST manual edit to an
  // AI-authored draft creates a new `human_edited` version. Every
  // subsequent edit, as long as the active draft is already `human_edited`,
  // updates that same row in place instead of stacking another version —
  // see pipeline/run.ts's applyManualSectionEdit doc comment (the mock's
  // equivalent) for the full reasoning, which applies identically here.
  let resultDraftId: string;
  let resultVersion: number;
  let createdNewVersion: boolean;

  if (activeDraft.generated_by === "human_edited") {
    const { error: updateDraftError } = await supabase
      .from("drafts")
      .update({ sections, updated_at: now })
      .eq("id", activeDraft.id);
    if (updateDraftError) throw updateDraftError;
    resultDraftId = activeDraft.id;
    resultVersion = activeDraft.version;
    createdNewVersion = false;
  } else {
    const { data: existingVersions, error: versionError } = await supabase
      .from("drafts")
      .select("version")
      .eq("request_id", request.id);
    if (versionError) throw versionError;
    const nextVersion = Math.max(0, ...(existingVersions ?? []).map((d) => d.version)) + 1;

    const newDraft: Draft = {
      id: randomUUID(),
      request_id: request.id,
      version: nextVersion,
      option_label: activeDraft.option_label,
      title: activeDraft.title,
      sections,
      generated_by: "human_edited",
      created_at: now,
      updated_at: now,
    };
    await insertDraft(supabase, newDraft);

    const { error: updateRequestError } = await supabase
      .from("requests")
      .update({ chosen_draft_id: newDraft.id, updated_at: now })
      .eq("id", request.id);
    if (updateRequestError) throw updateRequestError;

    resultDraftId = newDraft.id;
    resultVersion = newDraft.version;
    createdNewVersion = true;
  }

  const editorName = await getProfileName(supabase, input.edited_by);
  await logActivity(
    supabase,
    request.id,
    "human",
    input.edited_by,
    editorName,
    "edit_section",
    resultDraftId,
    createdNewVersion
      ? `Manually edited "${editedHeading}" (now v${resultVersion}).`
      : `Manually edited "${editedHeading}" (v${resultVersion}).`
  );

  return { ok: true, new_draft_id: resultDraftId };
}

// How long a needs_manual_revision request can sit with no failure_reason
// before it's treated as dead rather than still in progress — see the
// staleness comment inside handleRetryRevisionWebhook below. Matches this
// route's own maxDuration=300.
const REVISION_STALE_MS = 5 * 60 * 1000;

// Real-mode counterpart to mock/webhooks.ts's handleRetryRevisionWebhook —
// see that function's doc comment for why a dedicated retry is needed here
// (ReviewActions can't just "Request Changes" again against the same draft
// once a decision is already recorded for it). Re-dispatches the same
// revision in the background, same waitUntil pattern as the original
// request_changes handling above.
export async function handleRetryRevisionWebhook(
  input: RetryRevisionInput & { origin?: string }
): Promise<RetryRevisionResult> {
  const supabase = getSupabaseServerClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("*")
    .eq("id", input.request_id)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!requestRow) return { ok: false, reason: "not_found" };
  const request = rowToContentRequest(requestRow as RequestRow);

  // See mock/webhooks.ts's handleRetryRevisionWebhook doc comment: a
  // waitUntil'd revision can also die silently, with failure_reason never
  // set, if the function instance running it is killed mid-flight — so
  // this also accepts a retry once it's been stuck long enough that it
  // can't plausibly still be running (matches this route's own
  // maxDuration=300).
  const isStale = Date.now() - new Date(request.updated_at).getTime() > REVISION_STALE_MS;
  if (request.status !== "needs_manual_revision" || (!request.failure_reason && !isStale)) {
    return { ok: false, reason: "not_stalled" };
  }
  if (!request.chosen_draft_id) return { ok: false, reason: "not_found" };

  const { data: draftRow, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", request.chosen_draft_id)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draftRow) return { ok: false, reason: "not_found" };
  const draft = draftRow as Draft;

  const { data: decisionRow, error: decisionError } = await supabase
    .from("review_decisions")
    .select("notes")
    .eq("draft_id", draft.id)
    .eq("action", "request_changes")
    .maybeSingle();
  if (decisionError) throw decisionError;
  const notes = decisionRow?.notes ?? null;

  request.failure_reason = null;
  request.updated_at = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("requests")
    .update({ failure_reason: null, updated_at: request.updated_at })
    .eq("id", request.id);
  if (updateError) throw updateError;

  const retrierName = await getProfileName(supabase, input.retried_by);
  await logActivity(supabase, request.id, "human", input.retried_by, retrierName, "retry_revision", draft.id, null);

  const requestUrl = input.origin ? `${input.origin}/requests/${request.id}` : undefined;
  waitUntil(
    runRevisionPipeline(supabase, request, draft, notes).catch((err) =>
      recordRevisionFailure(supabase, request, `Automatic revision failed: ${String(err)}`, requestUrl)
    )
  );

  return { ok: true };
}
