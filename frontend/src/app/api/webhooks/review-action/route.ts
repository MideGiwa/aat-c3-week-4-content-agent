import { NextRequest, NextResponse } from "next/server";
import { submitReviewAction } from "@/lib/webhookClient";
import { getCurrentProfileId } from "@/lib/currentUser";

// Stands in for n8n's POST /webhook/review-action (FRONTEND-SPEC.md "Flow
// 2"). Returns 409 (not 200/500) for either of two distinct conflict
// outcomes the UI is expected to show specifically, not treat as a generic
// failure: "already_decided" (lost the review_decisions race) and
// "stale_draft" (acted on a draft the pipeline has since superseded with a
// newer version — see the guard in handleReviewActionWebhook).
//
// "request_changes" (and, when it needs to regenerate a never-drafted
// angle, "select_option") can trigger real Claude calls in the background
// via waitUntil — same maxDuration need as content-request/retry-request
// (2026-09-18 fix: this route had no maxDuration at all, so a real revision
// could get killed mid-flight by the platform's default timeout, leaving
// the request stuck at `needs_manual_revision` with nothing to tell the
// reviewer whether it was still working or had silently failed).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();

  // The client doesn't send reviewer_id today, so this always falls
  // through to the current session (MOCK_CURRENT_PROFILE_ID in mock mode;
  // whoever's logged in, in real mode). Kept as a fallback rather than the
  // only path in case a future caller (e.g. an admin acting on someone
  // else's behalf) ever needs to pass one explicitly.
  const currentProfileId = await getCurrentProfileId();
  const reviewerId = body.reviewer_id ?? currentProfileId;
  if (!reviewerId) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 401 });
  }

  const result = await submitReviewAction({
    request_id: body.request_id,
    draft_id: body.draft_id,
    channel_asset_id: body.channel_asset_id ?? null,
    action: body.action,
    reviewer_id: reviewerId,
    notes: body.notes ?? null,
    selected_option_label: body.selected_option_label ?? null,
    publish_timing: body.publish_timing,
    scheduled_for: body.scheduled_for,
    origin: req.nextUrl.origin,
  });

  if (!result.ok) {
    const status =
      result.reason === "already_decided" || result.reason === "stale_draft"
        ? 409
        : result.reason === "invalid_schedule"
          ? 400
          : 404;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
