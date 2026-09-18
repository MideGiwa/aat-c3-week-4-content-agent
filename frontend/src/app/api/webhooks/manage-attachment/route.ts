import { NextRequest, NextResponse } from "next/server";
import { submitManageAttachment } from "@/lib/webhookClient";

// Stands in for n8n's POST /webhook/manage-attachment (FRONTEND-SPEC.md
// "Additional webhook: attachment management").
export async function POST(req: NextRequest) {
  const body = await req.json();

  const result = await submitManageAttachment({
    request_id: body.request_id,
    attachment_id: body.attachment_id,
    action: body.action,
    new_storage_path: body.new_storage_path,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
