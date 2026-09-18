import { NextRequest, NextResponse } from "next/server";
import { submitRetryRevision } from "@/lib/webhookClient";
import { getCurrentProfileId } from "@/lib/currentUser";

// Retries the automatic revision after it failed in the background
// following a "Request Changes" decision (2026-09-18 fix — see
// supabase/webhooks.ts's recordRevisionFailure/handleRetryRevisionWebhook
// doc comments for why this needs its own endpoint rather than just
// resubmitting "request_changes"). Same background-execution shape as the
// other pipeline-triggering routes, so the same maxDuration.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();

  const retriedBy = await getCurrentProfileId();
  if (!retriedBy) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 401 });
  }

  const result = await submitRetryRevision({
    request_id: body.request_id,
    retried_by: retriedBy,
    origin: req.nextUrl.origin,
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
