import { NextRequest, NextResponse } from "next/server";
import { submitManualEdit } from "@/lib/webhookClient";
import { getCurrentProfileId } from "@/lib/currentUser";

// Backs the "inline edit, but versioned" feature (DESIGN.md decisions log,
// 2026-09-18) — a reviewer editing a draft section's wording directly
// instead of only being able to request a full AI revision. No background
// work here (no AI call), so this doesn't need the longer maxDuration the
// content-request/retry-request routes do.
export async function POST(req: NextRequest) {
  const body = await req.json();

  const editedBy = await getCurrentProfileId();
  if (!editedBy) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 401 });
  }

  const result = await submitManualEdit({
    request_id: body.request_id,
    draft_id: body.draft_id,
    section_index: body.section_index,
    new_body: body.new_body,
    edited_by: editedBy,
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "locked"
          ? 403
          : result.reason === "invalid_section"
            ? 400
            : 409; // stale_draft
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
