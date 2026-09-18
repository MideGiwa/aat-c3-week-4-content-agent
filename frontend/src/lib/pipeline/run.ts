// Pipeline orchestration — the automated stretch between "request submitted"
// and "ready for a human to look at": research, source curation, planning,
// draft generation, self-evaluation, revision, and channel-specific prep.
//
// This used to be split across an n8n workflow and a standalone Python/
// FastAPI "LLM service" (LLM-SERVICE-SPEC.md). Both are superseded — see
// CONTENT-PIPELINE-SPEC.md — in favor of running the whole thing as Next.js
// server code, called synchronously from the intake and review-action
// webhook handlers (src/lib/mock/webhooks.ts). In mock mode this is cheap
// enough to run inline (no real network calls); real mode would run the
// same steps against real APIs, most likely from a background job rather
// than blocking the HTTP response — see the README "Going from mock to
// real" section.

import type { ContentRequest, Draft, SourceRef } from "../types";
import type { MockStore } from "../mock/store";
import { nextId } from "../mock/store";
import {
  evaluateDraft,
  generateDraft,
  generateSources,
  planTitleOptions,
  prepareChannelAssets,
  reviseDraft,
} from "./generate";

const MAX_AUTO_REVISION_ROUNDS = 1; // matches the seed example (draft-1 → draft-2, one auto-revision)

type PipelineActivityAction =
  | "complete_research"
  | "select_option"
  | "switch_to_existing_draft"
  | "evaluate_draft"
  | "regenerate_draft"
  | "edit_section"
  | "prepare_channel_assets";

function logActivity(
  store: MockStore,
  requestId: string,
  action: PipelineActivityAction,
  notes: string | null,
  target: string | null = null
) {
  store.activity.push({
    id: nextId("act"),
    request_id: requestId,
    actor_type: "system",
    actor_id: null,
    actor_name: "System",
    action,
    target,
    notes,
    created_at: new Date().toISOString(),
  });
}

/** Draft → evaluate → (if flagged) revise once → evaluate again. Shared by
 * the initial pipeline run and by a reviewer switching content angles
 * (runSelectOptionPipeline below) — both cases are "produce a reviewable
 * draft for this title from scratch," they just differ in which title and
 * whether a human or the pipeline's own heuristic picked it. Draft versions
 * are numbered continuously per request so VersionHistory shows one linear
 * timeline regardless of which path produced each entry. */
function generateDraftWithAutoRevision(
  request: ContentRequest,
  sources: SourceRef[],
  title: string,
  store: MockStore,
  optionLabel: string
): Draft {
  const nextVersion =
    Math.max(0, ...store.drafts.filter((d) => d.request_id === request.id).map((d) => d.version)) + 1;

  let draft: Draft = generateDraft(request, sources, title, nextVersion, "system_initial", optionLabel);
  store.drafts.push(draft);

  let evaluation = evaluateDraft(request, draft, 1);
  store.evaluations.push(evaluation);
  logActivity(
    store,
    request.id,
    "evaluate_draft",
    `Round 1: ${evaluation.status}.${evaluation.unsupported_claims.length > 0 ? ` Flagged: ${evaluation.unsupported_claims.join(" ")}` : ""}`,
    draft.id
  );

  let round = 1;
  while (evaluation.status !== "pass" && round <= MAX_AUTO_REVISION_ROUNDS) {
    const revised = reviseDraft(draft, sources, evaluation, "system_revision");
    store.drafts.push(revised);
    logActivity(
      store,
      request.id,
      "regenerate_draft",
      `Automatic revision after round ${round} evaluation flagged: ${evaluation.sections_needing_revision.join(", ")}.`,
      revised.id
    );

    round += 1;
    draft = revised;
    evaluation = evaluateDraft(request, draft, round);
    store.evaluations.push(evaluation);
    logActivity(
      store,
      request.id,
      "evaluate_draft",
      `Round ${round}: ${evaluation.status}.`,
      draft.id
    );
  }

  return draft;
}

/** Runs the full automated pipeline for a freshly-submitted request, taking
 * it from `intake_complete` to `pending_human_review` (mock mode always
 * succeeds at research — see generate.ts's module doc for why a research
 * failure isn't simulated here; EDGE-CASES-AND-GUARDRAILS.md covers that
 * failure path for the real system). Mutates the store in place. */
export function runInitialPipeline(request: ContentRequest, store: MockStore): void {
  const sources = generateSources(request);
  store.sources.push(...sources);
  logActivity(
    store,
    request.id,
    "complete_research",
    `Retrieved ${sources.length} source(s); ${sources.filter((s) => s.selected).length} selected as relevant, ${sources.filter((s) => !s.selected).length} rejected below the relevance floor.`
  );

  const { options, chosenIndex, reason } = planTitleOptions(request);
  const chosenTitle = options[chosenIndex];
  // Both options (and why one was picked) are kept on the request itself,
  // not just logged, so a reviewer can later see and override this choice
  // — see runSelectOptionPipeline and the ContentAngleSelector component.
  request.title_options = options;
  request.chosen_title_index = chosenIndex;
  request.title_option_reason = reason;
  logActivity(
    store,
    request.id,
    "select_option",
    `Considered 2 title/angle options ("${options[0]}" vs. "${options[1]}"); selected "${chosenTitle}" — ${reason}`
  );

  const optionLabel = chosenIndex === 0 ? "A" : "B";
  const draft = generateDraftWithAutoRevision(request, sources, chosenTitle, store, optionLabel);
  request.chosen_draft_id = draft.id;

  const channelAssets = prepareChannelAssets(request, draft);
  store.channelAssets.push(...channelAssets);
  logActivity(
    store,
    request.id,
    "prepare_channel_assets",
    `Prepared copy for: ${channelAssets.map((c) => c.channel).join(", ")}.`
  );

  request.status = "pending_human_review";
  request.updated_at = new Date().toISOString();
}

/** Lets a reviewer override the pipeline's automatic angle pick (PRD:
 * "...or select content", before publishing). Per the 2026-09-18 UI
 * revision (DESIGN.md decisions log): switching to an angle that already
 * has a generated draft does NOT regenerate anything — it just repoints
 * request.chosen_draft_id at the existing (highest-version) draft under
 * that option_label, with no new draft row and no AI call. Only an angle
 * that has never been drafted under this request triggers the
 * evaluate/auto-revise generation loop, same as a brand-new request. The
 * human-attributed `select_option` activity entry (who switched it and why)
 * is logged by the caller in handleReviewActionWebhook, before this runs;
 * this function only decides reuse-vs-regenerate and does whichever one
 * applies. */
export function runSelectOptionPipeline(request: ContentRequest, newIndex: 0 | 1, store: MockStore): void {
  if (!request.title_options) return;
  const newTitle = request.title_options[newIndex];
  const newLabel = newIndex === 0 ? "A" : "B";
  const sources = store.sources.filter((s) => s.request_id === request.id);

  const existingDraftsForOption = store.drafts
    .filter((d) => d.request_id === request.id && d.option_label === newLabel)
    .sort((a, b) => b.version - a.version);
  const existingDraft = existingDraftsForOption[0];

  request.chosen_title_index = newIndex;

  if (existingDraft) {
    // The version already exists — switch to it. No copy, no new draft, no
    // AI call. Channel assets are keyed by draft_id (not request_id), so
    // whatever copy was prepared for this draft the last time it was
    // active is still sitting there untouched — nothing to regenerate.
    request.chosen_draft_id = existingDraft.id;
    logActivity(
      store,
      request.id,
      "switch_to_existing_draft",
      `Switched back to v${existingDraft.version} (previously generated for this option) — no regeneration needed.`,
      existingDraft.id
    );
  } else {
    const draft = generateDraftWithAutoRevision(request, sources, newTitle, store, newLabel);
    request.chosen_draft_id = draft.id;

    const channelAssets = prepareChannelAssets(request, draft);
    store.channelAssets.push(...channelAssets);
    logActivity(
      store,
      request.id,
      "prepare_channel_assets",
      `Prepared copy for: ${channelAssets.map((c) => c.channel).join(", ")}.`,
      draft.id
    );
  }

  request.status = "pending_human_review";
  request.updated_at = new Date().toISOString();
}

/** Runs a targeted revision after a reviewer requests changes — reuses the
 * same revise/evaluate/prepare-channel-copy steps as the automatic
 * mid-pipeline revision above, but seeded with the reviewer's own notes
 * rather than the evaluator's. Channel assets are keyed by draft_id (not
 * request_id) and never deleted (2026-09-18) — old versions' copy just
 * stops being "active" once chosen_draft_id moves on, the same way old
 * draft versions themselves are kept rather than overwritten.
 * Sets the request straight back to `pending_human_review` with the new
 * version ready — see CONTENT-PIPELINE-SPEC.md §7 for why this resolves
 * synchronously instead of leaving the request sitting at
 * `needs_manual_revision` (that status still exists and is shown in the UI
 * for however briefly it's true, and is what a slower/real-mode revision
 * pass would actually rest at). */
export function runRevisionPipeline(
  request: ContentRequest,
  latestDraft: Draft,
  reviewerNotes: string | null,
  store: MockStore
): void {
  const sources = store.sources.filter((s) => s.request_id === request.id);
  const priorEvaluations = store.evaluations
    .filter((e) => e.draft_id === latestDraft.id)
    .sort((a, b) => b.round - a.round);
  const latestEvaluation = priorEvaluations[0] ?? evaluateDraft(request, latestDraft, 1);
  const maxRound = Math.max(0, ...store.evaluations.filter((e) => e.draft_id === latestDraft.id).map((e) => e.round));

  // If the AI evaluation had nothing flagged (a human is requesting changes
  // for reasons the rubric didn't catch), still revise something concrete:
  // treat the first section as the one to touch so the reviewer's note is
  // visibly addressed rather than silently ignored.
  const evaluationForRevision =
    latestEvaluation.sections_needing_revision.length > 0
      ? latestEvaluation
      : { ...latestEvaluation, sections_needing_revision: [latestDraft.sections[0]?.heading].filter(Boolean) as string[] };

  const revised = reviseDraft(latestDraft, sources, evaluationForRevision, "human_requested", reviewerNotes);
  store.drafts.push(revised);
  request.chosen_draft_id = revised.id;
  logActivity(
    store,
    request.id,
    "regenerate_draft",
    `Regenerated following reviewer-requested changes${reviewerNotes ? `: "${reviewerNotes}"` : "."}`,
    revised.id
  );

  const newEvaluation = evaluateDraft(request, revised, maxRound + 1);
  store.evaluations.push(newEvaluation);
  logActivity(store, request.id, "evaluate_draft", `Round ${newEvaluation.round}: ${newEvaluation.status}.`, revised.id);

  const channelAssets = prepareChannelAssets(request, revised);
  store.channelAssets.push(...channelAssets);
  logActivity(
    store,
    request.id,
    "prepare_channel_assets",
    `Prepared copy for: ${channelAssets.map((c) => c.channel).join(", ")}.`,
    revised.id
  );

  request.status = "pending_human_review";
  request.updated_at = new Date().toISOString();
}

export interface ManualEditOutcome {
  draft: Draft;
  /** True the one time this call actually created a new draft version
   * (the first manual edit made to an AI-authored draft). False on every
   * subsequent edit, which instead updates that same human_edited draft row
   * in place — see this function's doc comment for why. Lets the caller
   * write an accurate activity note ("now v3" vs. just "edited again"). */
  createdNewVersion: boolean;
}

/** Applies one section's edited body to the request's active draft — the
 * "inline edit, but versioned" manual-editing feature (2026-09-18 UI
 * revision note: "I should be able to edit sections manually"). No AI call,
 * no re-evaluation, no channel-copy regeneration; this is a surgical text
 * change.
 *
 * Version behavior (reworked 2026-09-18 — user feedback: "if 50 changes are
 * made that is 50 new versions"): the FIRST manual edit to an AI-authored
 * draft (system_initial/system_revision/human_requested) creates a new
 * draft version tagged `human_edited`, exactly like every other
 * draft-producing action in this app — that one is worth a version boundary
 * since it's the moment a human started hand-editing AI output. Every
 * *subsequent* edit, as long as the active draft is already `human_edited`
 * and still undecided, mutates that SAME draft row in place (sections +
 * updated_at) instead of stacking another version — a reviewer tweaking
 * wording 50 times produces one version with 50 activity-log entries behind
 * it, not 50 versions cluttering VersionHistory. This is safe specifically
 * because a `human_edited` draft has no evaluation and no channel copy
 * generated against it (both are skipped for this path) — nothing else
 * treats its content as immutable the way an AI-authored version's
 * evaluation/channel-copy rows implicitly do. The moment anything else
 * (an AI revision, an angle switch) produces a new active draft, the next
 * manual edit starts a fresh version again.
 *
 * Repoints request.chosen_draft_id at whichever draft is being written to
 * (a no-op after the first edit, since it's already that draft). Activity
 * logging is the caller's job (handleManualEditWebhook) since it's
 * human-attributed, not something this pipeline-layer function should
 * hardcode to "System" the way logActivity() above does. */
export function applyManualSectionEdit(
  request: ContentRequest,
  activeDraft: Draft,
  sectionIndex: number,
  newBody: string,
  store: MockStore
): ManualEditOutcome {
  const now = new Date().toISOString();

  if (activeDraft.generated_by === "human_edited") {
    activeDraft.sections = activeDraft.sections.map((s, idx) =>
      idx === sectionIndex ? { ...s, body: newBody } : s
    );
    activeDraft.updated_at = now;
    request.updated_at = now;
    return { draft: activeDraft, createdNewVersion: false };
  }

  const nextVersion =
    Math.max(0, ...store.drafts.filter((d) => d.request_id === request.id).map((d) => d.version)) + 1;

  const sections = activeDraft.sections.map((s, idx) =>
    idx === sectionIndex ? { ...s, body: newBody } : s
  );

  const newDraft: Draft = {
    id: nextId("draft"),
    request_id: request.id,
    version: nextVersion,
    option_label: activeDraft.option_label,
    title: activeDraft.title,
    sections,
    generated_by: "human_edited",
    created_at: now,
    updated_at: now,
  };
  store.drafts.push(newDraft);
  request.chosen_draft_id = newDraft.id;
  request.updated_at = now;
  return { draft: newDraft, createdNewVersion: true };
}

/** Promotes this request's channel-specific copy from "draft" to
 * "ready_to_publish" once a human approves the article — this is what
 * makes LinkedIn/X rows eligible for the n8n publish runner's query
 * (n8n-publish-workflow.json polls for `status = 'ready_to_publish'`).
 * Newsletter rows are promoted the same way for consistency (they're just
 * as "ready" as the others) even though nothing currently consumes them —
 * see DESIGN.md §11 "Scope note." */
export function promoteChannelAssetsToReadyToPublish(requestId: string, draftId: string, store: MockStore): void {
  for (const asset of store.channelAssets) {
    if (asset.request_id === requestId && asset.draft_id === draftId && asset.status === "draft") {
      asset.status = "ready_to_publish";
    }
  }
}
