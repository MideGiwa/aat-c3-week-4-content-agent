import { NextRequest, NextResponse } from "next/server";
import { submitRetryRequest } from "@/lib/webhookClient";
import { getCurrentProfileId } from "@/lib/currentUser";

// Re-runs the initial pipeline for a request stuck at `research_failed` —
// same background-execution shape as /api/webhooks/content-request (the
// pipeline can take low tens of seconds to a couple of minutes against
// real APIs), so this needs the same maxDuration.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();

  const retriedBy = await getCurrentProfileId();
  if (!retriedBy) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 401 });
  }

  const result = await submitRetryRequest({
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
