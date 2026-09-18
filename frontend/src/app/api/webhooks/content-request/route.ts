import { NextRequest, NextResponse } from "next/server";
import { submitContentRequest } from "@/lib/webhookClient";
import { getCurrentProfileId } from "@/lib/currentUser";

// Real mode: intake itself (this handler) returns as soon as the request
// row exists; the actual research/drafting pipeline keeps running in the
// background afterward (src/lib/supabase/webhooks.ts's use of waitUntil).
// maxDuration covers that background work, not just this handler's own
// fast path — raise it further if a Vercel plan's ceiling allows and
// pipeline runs are still timing out.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();

  // In mock mode this is always MOCK_CURRENT_PROFILE_ID; in real mode it's
  // whoever's session cookie middleware.ts already required to get here. A
  // null here would mean middleware let an unauthenticated request through,
  // which shouldn't happen — refused explicitly rather than silently
  // attributing the request to nobody.
  const submittedBy = await getCurrentProfileId();
  if (!submittedBy) {
    return NextResponse.json(
      { ok: false, errors: [{ field: "_", message: "Not signed in." }] },
      { status: 401 }
    );
  }

  const result = await submitContentRequest({
    idea_or_topic: body.idea_or_topic ?? "",
    target_audience: body.target_audience ?? "",
    source_url: body.source_url ?? "",
    tone: body.tone ?? "",
    priority_channels: body.priority_channels ?? [],
    publish_timing: body.publish_timing ?? "immediately",
    scheduled_for: body.scheduled_for ?? "",
    attachment_file_name: body.attachment_file_name,
    attachment_size_bytes: body.attachment_size_bytes,
    custom_rubric_criteria: body.custom_rubric_criteria ?? [],
    submitted_by: submittedBy,
    reviewer_ids: body.reviewer_ids ?? [],
    origin: req.nextUrl.origin,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json(result, { status: 200 });
}
