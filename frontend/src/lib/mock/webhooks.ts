// Mock-mode stand-ins for the three webhooks handled for real by
// src/lib/supabase/webhooks.ts: content-request, review-action,
// manage-attachment. Runs against the in-memory mock store instead of
// Supabase, synchronously (no real network calls to fake) — the *shapes*
// below are what real mode's functions also implement, per
// src/lib/webhookClient.ts.

import { getStore, nextId } from "./store";
import { isFutureDateTime, validateNewRequest, type NewRequestInput } from "../validation";
import type { Channel, ContentRequest } from "../types";
import {
  applyManualSectionEdit,
  promoteChannelAssetsToReadyToPublish,
  runInitialPipeline,
  runRevisionPipeline,
  runSelectOptionPipeline,
} from "../pipeline/run";

export interface ContentRequestWebhookResult {
  ok: boolean;
  request_id?: string;
  status?: ContentRequest["status"];
  errors?: { field: string; message: string }[];
}

export function handleContentRequestWebhook(
  input: NewRequestInput & { submitted_by: string; reviewer_ids: string[] }
): ContentRequestWebhookResult {
  // This is the actual gate — re-validated here exactly as n8n would,
  // regardless of what the browser's form already checked.
  // See INTAKE-AND-RESEARCH-SPEC.md §1, "why re-validate server-side."
  const errors = validateNewRequest(input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const store = getStore();
  const now = new Date().toISOString();
  const requestId = nextId("req");

  const newRequest: ContentRequest = {
    id: requestId,
    idea_or_topic: input.idea_or_topic.trim(),
    target_audience: input.target_audience.trim(),
    source_url: input.source_url || null,
    tone: input.tone || "professional",
    priority_channels: (input.priority_channels as Channel[]) ?? ["linkedin", "x", "newsletter"],
    // Publish timing is no longer collected at intake — a request's fate
    // isn't known yet at submission time, and the PRD's own ordering is
    // "review, THEN publish or schedule." Left null here (fixed 2026-09-18
    // — this used to default to "immediately", which made every
    // unreviewed request look already decided) and only ever set for real
    // when a human approves (handleReviewActionWebhook below).
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
  store.requests.push(newRequest);

  store.activity.push({
    id: nextId("act"),
    request_id: requestId,
    actor_type: "human",
    actor_id: input.submitted_by,
    actor_name: store.profiles.find((p) => p.id === input.submitted_by)?.name ?? "Unknown",
    action: "submit_request",
    target: null,
    notes: null,
    created_at: now,
  });

  // Research & Retrieval through Channel Prep now run right here, as
  // regular Next.js server code (CONTENT-PIPELINE-SPEC.md — this replaces
  // the earlier plan to hand off to n8n / a standalone LLM service). It's
  // cheap enough in mock mode to run synchronously before this function
  // returns, so by the time the request is created it's already sitting at
  // pending_human_review with a draft, an evaluation, and channel copy
  // ready — not stuck at intake_complete waiting on a stage that hasn't
  // run yet.
  runInitialPipeline(newRequest, store);

  return { ok: true, request_id: requestId, status: newRequest.status };
}

export interface ReviewActionInput {
  request_id: string;
  draft_id: string;
  channel_asset_id?: string | null;
  action: "approve" | "reject" | "request_changes" | "select_option";
  reviewer_id: string;
  notes?: string | null;
  selected_option_label?: string | null;
  /** Only meaningful on "approve" — this is where publish timing is
   * actually decided now (see handleContentRequestWebhook), not at intake. */
  publish_timing?: "immediately" | "scheduled";
  scheduled_for?: string | null;
}

export type ReviewActionWebhookResult =
  | { ok: true; new_status: ContentRequest["status"] }
  | { ok: false; reason: "already_decided"; decided_by: string; decided_action: string }
  | { ok: false; reason: "stale_draft"; current_draft_id: string | null }
  | { ok: false; reason: "invalid_schedule"; message: string }
  | { ok: false; reason: "not_found" };

export function handleReviewActionWebhook(
  input: ReviewActionInput
): ReviewActionWebhookResult {
  const store = getStore();
  const request = store.requests.find((r) => r.id === input.request_id);
  if (!request) return { ok: false, reason: "not_found" };

  // Guards against acting on a superseded draft — e.g. a browser tab left
  // open on an old version, or a replayed/retried request arriving after an
  // automatic revision has already produced a newer one. The UI only ever
  // renders review actions against the ACTIVE draft (DraftReviewPanel, via
  // request.chosen_draft_id — not simply "highest version number" since the
  // 2026-09-18 angle-switching fix, see ContentRequest.chosen_draft_id's
  // doc comment), but nothing stopped a direct call from targeting an
  // older/inactive draft_id and silently moving the request to
  // approved/rejected against content that's no longer what a human would
  // see. "Gate, don't guess" applies here the same way it does to the
  // already-decided race below — check explicitly rather than assume the
  // caller sent the right id.
  const currentDraft = request.chosen_draft_id
    ? store.drafts.find((d) => d.id === request.chosen_draft_id) ?? null
    : null;
  if (input.action !== "select_option" && currentDraft && currentDraft.id !== input.draft_id) {
    return { ok: false, reason: "stale_draft", current_draft_id: currentDraft.id };
  }

  // This is the part worth getting right: a real UNIQUE constraint on
  // review_decisions.draft_id means two reviewers can never both
  // successfully record a decision on the same draft, no matter how close
  // together their clicks land. The mock store can't lean on an actual
  // Postgres constraint, so it reproduces the same guarantee with a
  // find-then-refuse check performed as a single synchronous step (Node is
  // single-threaded per request in dev, so this is race-safe here the same
  // way the real UNIQUE constraint is race-safe under concurrent
  // transactions — the point is "only the first decision is ever
  // recorded," however it's enforced).
  const existing = store.decisions.find((d) => d.draft_id === input.draft_id);
  if (existing) {
    const decidedBy = store.profiles.find((p) => p.id === existing.reviewer_id)?.name ?? "another reviewer";
    return { ok: false, reason: "already_decided", decided_by: decidedBy, decided_action: existing.action };
  }

  // Approve is also where publish timing is now decided (see
  // handleContentRequestWebhook — it's no longer collected at intake).
  // Validated here the same way intake used to validate it, so a bad
  // schedule can't slip through just because the picker moved screens.
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
  const reviewer = store.profiles.find((p) => p.id === input.reviewer_id);

  if (input.action === "approve" || input.action === "reject" || input.action === "request_changes") {
    store.decisions.push({
      id: nextId("dec"),
      draft_id: input.draft_id,
      action: input.action,
      reviewer_id: input.reviewer_id,
      notes: input.notes ?? null,
      decided_at: now,
    });
  }

  let newStatus: ContentRequest["status"] = request.status;
  if (input.action === "approve") newStatus = "approved";
  else if (input.action === "reject") newStatus = "rejected_by_human";
  else if (input.action === "request_changes") newStatus = "needs_manual_revision";
  else if (input.action === "select_option") newStatus = request.status; // unchanged; just records a choice

  request.status = newStatus;
  request.updated_at = now;

  if (input.action === "approve") {
    request.publish_timing = input.publish_timing ?? "immediately";
    request.scheduled_for = input.publish_timing === "scheduled" ? input.scheduled_for ?? null : null;
  }

  // select_option's own activity note is built here (rather than passed
  // through from the client) so the "what changed and why" text always
  // reflects the actual title swap, not whatever a caller happened to send.
  let activityNotes = input.notes ?? null;
  if (input.action === "select_option" && request.title_options) {
    const idx = input.selected_option_label === "B" ? 1 : 0;
    const previousIdx = request.chosen_title_index ?? 0;
    activityNotes =
      idx === previousIdx
        ? `Kept option ${input.selected_option_label ?? "A"}: "${request.title_options[idx]}".`
        : `Switched to option ${input.selected_option_label ?? "A"}: "${request.title_options[idx]}" — overriding the earlier pick ("${request.title_options[previousIdx]}").`;
  }

  store.activity.push({
    id: nextId("act"),
    request_id: input.request_id,
    actor_type: "human",
    actor_id: input.reviewer_id,
    actor_name: reviewer?.name ?? "Unknown reviewer",
    action: input.action,
    target: input.action === "select_option" ? null : input.draft_id,
    notes: activityNotes,
    created_at: now,
  });

  // Downstream pipeline reactions to the decision — same module the intake
  // webhook uses (CONTENT-PIPELINE-SPEC.md §7).
  if (input.action === "approve") {
    // Makes this draft's channel copy eligible for the n8n publish runner.
    promoteChannelAssetsToReadyToPublish(input.request_id, input.draft_id, store);
  } else if (input.action === "request_changes") {
    const draft = store.drafts.find((d) => d.id === input.draft_id);
    if (draft) {
      // Resolves synchronously back to pending_human_review with a new
      // version ready — see runRevisionPipeline's doc comment for why.
      runRevisionPipeline(request, draft, input.notes ?? null, store);
      newStatus = request.status;
    }
  } else if (input.action === "select_option" && request.title_options) {
    const idx: 0 | 1 = input.selected_option_label === "B" ? 1 : 0;
    if (idx !== request.chosen_title_index) {
      runSelectOptionPipeline(request, idx, store);
      newStatus = request.status;
    }
  }

  return { ok: true, new_status: newStatus };
}

export interface ManageAttachmentInput {
  request_id: string;
  attachment_id: string;
  action: "remove" | "replace";
  new_storage_path?: string;
}

export type ManageAttachmentResult =
  | { ok: true }
  | { ok: false; reason: "already_consumed_by_research" | "not_found" };

export function handleManageAttachmentWebhook(
  input: ManageAttachmentInput
): ManageAttachmentResult {
  const store = getStore();
  const request = store.requests.find((r) => r.id === input.request_id);
  const attachment = store.attachments.find((a) => a.id === input.attachment_id);
  if (!request || !attachment) return { ok: false, reason: "not_found" };

  // DESIGN.md §14: editable/removable only before Research & Retrieval has
  // actually consumed it. "intake_complete" is the only status where that's
  // still true for this request.
  if (request.status !== "intake_complete") {
    return { ok: false, reason: "already_consumed_by_research" };
  }

  if (input.action === "remove") {
    attachment.status = "removed";
    attachment.removed_at = new Date().toISOString();
  }

  store.activity.push({
    id: nextId("act"),
    request_id: input.request_id,
    actor_type: "human",
    actor_id: request.submitted_by,
    actor_name: store.profiles.find((p) => p.id === request.submitted_by)?.name ?? "Unknown",
    action: "remove_attachment",
    target: input.attachment_id,
    notes: null,
    created_at: new Date().toISOString(),
  });

  return { ok: true };
}

export interface RetryRequestInput {
  request_id: string;
  retried_by: string;
}

export type RetryRequestResult =
  | { ok: true; status: ContentRequest["status"] }
  | { ok: false; reason: "not_found" | "not_failed" };

// A hard pipeline failure (research_failed) can happen after some of the
// pipeline's own rows already exist for this request — e.g. a failure
// during drafting or channel prep, not just research itself (see
// src/lib/supabase/webhooks.ts's failResearch doc comment: it's the
// generic catch-all for any stage). Retrying re-runs the whole initial
// pipeline from scratch rather than trying to resume mid-stage, so any
// partial sources/drafts/evaluations/channel-assets from the failed
// attempt are cleared first — otherwise a second run would pile up
// alongside the first instead of replacing it (e.g. two "version 1"
// drafts, or duplicate sources).
export function handleRetryRequestWebhook(input: RetryRequestInput): RetryRequestResult {
  const store = getStore();
  const request = store.requests.find((r) => r.id === input.request_id);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "research_failed") return { ok: false, reason: "not_failed" };

  store.sources = store.sources.filter((s) => s.request_id !== request.id);
  const staleDraftIds = new Set(
    store.drafts.filter((d) => d.request_id === request.id).map((d) => d.id)
  );
  store.drafts = store.drafts.filter((d) => d.request_id !== request.id);
  store.evaluations = store.evaluations.filter((e) => !staleDraftIds.has(e.draft_id));
  store.channelAssets = store.channelAssets.filter((c) => c.request_id !== request.id);

  request.status = "intake_complete";
  request.failure_reason = null;
  request.title_options = null;
  request.chosen_title_index = null;
  request.title_option_reason = null;
  request.chosen_draft_id = null;
  request.publish_timing = null;
  request.scheduled_for = null;
  request.updated_at = new Date().toISOString();

  store.activity.push({
    id: nextId("act"),
    request_id: request.id,
    actor_type: "human",
    actor_id: input.retried_by,
    actor_name: store.profiles.find((p) => p.id === input.retried_by)?.name ?? "Unknown",
    action: "retry_pipeline",
    target: null,
    notes: null,
    created_at: new Date().toISOString(),
  });

  // Mock mode's pipeline is synchronous/instant (no real APIs to fail
  // against) — same as the initial-submission path in this file.
  runInitialPipeline(request, store);

  return { ok: true, status: request.status };
}

export interface ManualEditInput {
  request_id: string;
  /** The draft the reviewer was looking at when they clicked Save — must
   * still be the request's active draft, same staleness guard
   * handleReviewActionWebhook applies to approve/reject/request_changes. */
  draft_id: string;
  section_index: number;
  new_body: string;
  edited_by: string;
}

export type ManualEditResult =
  | { ok: true; new_draft_id: string }
  | { ok: false; reason: "not_found" | "stale_draft" | "locked" | "invalid_section" };

// Backs the "inline edit, but versioned" feature (DESIGN.md decisions log,
// 2026-09-18): a reviewer can fix a section's wording directly instead of
// only being able to request a full AI revision. Locked the same way every
// other review action is — once a decision is recorded against the active
// draft, its content is frozen, so this can't be used to quietly change
// what a reviewer already approved/rejected.
export function handleManualEditWebhook(input: ManualEditInput): ManualEditResult {
  const store = getStore();
  const request = store.requests.find((r) => r.id === input.request_id);
  if (!request) return { ok: false, reason: "not_found" };

  const activeDraft = request.chosen_draft_id
    ? store.drafts.find((d) => d.id === request.chosen_draft_id)
    : undefined;
  if (!activeDraft) return { ok: false, reason: "not_found" };

  if (activeDraft.id !== input.draft_id) {
    return { ok: false, reason: "stale_draft" };
  }

  const existingDecision = store.decisions.find((d) => d.draft_id === activeDraft.id);
  if (existingDecision) {
    return { ok: false, reason: "locked" };
  }

  if (input.section_index < 0 || input.section_index >= activeDraft.sections.length) {
    return { ok: false, reason: "invalid_section" };
  }

  const editor = store.profiles.find((p) => p.id === input.edited_by);
  const editedHeading = activeDraft.sections[input.section_index].heading;
  const { draft, createdNewVersion } = applyManualSectionEdit(
    request,
    activeDraft,
    input.section_index,
    input.new_body,
    store
  );

  // Every edit gets its own activity entry regardless of whether it created
  // a new version — the audit trail of "what changed and when" stays
  // granular even though repeated edits to the same human_edited draft no
  // longer stack new versions (2026-09-18 fix).
  store.activity.push({
    id: nextId("act"),
    request_id: request.id,
    actor_type: "human",
    actor_id: input.edited_by,
    actor_name: editor?.name ?? "Unknown reviewer",
    action: "edit_section",
    target: draft.id,
    notes: createdNewVersion
      ? `Manually edited "${editedHeading}" (now v${draft.version}).`
      : `Manually edited "${editedHeading}" (v${draft.version}).`,
    created_at: new Date().toISOString(),
  });

  return { ok: true, new_draft_id: draft.id };
}

export interface RetryRevisionInput {
  request_id: string;
  retried_by: string;
}

export type RetryRevisionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_stalled" };

// Real-mode-primarily safety net (2026-09-18): the automatic revision after
// a "Request Changes" decision now runs in the background (waitUntil in
// supabase/webhooks.ts) instead of blocking that response, so it can fail
// on its own — e.g. a Claude API hiccup — leaving the request stuck at
// `needs_manual_revision` with a `failure_reason` set. The reviewer can't
// just click "Request Changes" again from ReviewActions to retry: the
// UNIQUE constraint on review_decisions.draft_id means a decision was
// already recorded against this exact draft, permanently locking it there.
// This re-attempts the SAME revision (same draft, same original notes)
// without needing a new decision. Mock mode's pipeline never actually
// fails (no real APIs), so this mostly exists here for interface parity
// with the real implementation and so the button has something to hit in
// mock-mode demos of the failure UI.
export function handleRetryRevisionWebhook(input: RetryRevisionInput): RetryRevisionResult {
  const store = getStore();
  const request = store.requests.find((r) => r.id === input.request_id);
  if (!request) return { ok: false, reason: "not_found" };
  if (request.status !== "needs_manual_revision" || !request.failure_reason) {
    return { ok: false, reason: "not_stalled" };
  }

  const draft = request.chosen_draft_id
    ? store.drafts.find((d) => d.id === request.chosen_draft_id)
    : undefined;
  if (!draft) return { ok: false, reason: "not_found" };

  const decision = store.decisions.find((d) => d.draft_id === draft.id && d.action === "request_changes");
  const notes = decision?.notes ?? null;

  request.failure_reason = null;
  request.updated_at = new Date().toISOString();

  const retrier = store.profiles.find((p) => p.id === input.retried_by);
  store.activity.push({
    id: nextId("act"),
    request_id: request.id,
    actor_type: "human",
    actor_id: input.retried_by,
    actor_name: retrier?.name ?? "Unknown reviewer",
    action: "retry_revision",
    target: draft.id,
    notes: null,
    created_at: new Date().toISOString(),
  });

  // Mock mode's pipeline is synchronous/instant — same as every other mock
  // pipeline entrypoint.
  runRevisionPipeline(request, draft, notes, store);

  return { ok: true };
}
