// Admin-only user provisioning. There's no public signup page (DESIGN.md's
// auth decisions-log entry) — this is the only way a new account gets
// created in real mode. It does two things atomically-ish: creates the
// actual Supabase Auth user via the Admin API (inviteUserByEmail — this
// both creates auth.users row AND emails them a one-time invite link that
// establishes their first session; every sign-in after that goes through
// the ordinary /login magic-link flow, not another invite), then inserts
// the matching profiles row with the name/roles this form collected.
//
// Requires the secret-key client because auth.admin.* calls are
// privileged — they can't be made with the publishable key at all, session
// or not.

import { NextRequest, NextResponse } from "next/server";
import { USE_MOCK_DATA } from "@/lib/config";
import { getCurrentProfile } from "@/lib/currentUser";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const VALID_ROLES = new Set(["content_manager", "reviewer", "admin"]);

export async function POST(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json(
      { ok: false, message: "User provisioning is a real-mode feature — nothing to manage in mock mode." },
      { status: 400 }
    );
  }

  const caller = await getCurrentProfile();
  if (!caller || !caller.roles.includes("admin")) {
    return NextResponse.json({ ok: false, message: "Admin only." }, { status: 403 });
  }

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const roles = (Array.isArray(body.roles) ? body.roles : []).filter(
    (r: unknown): r is string => typeof r === "string" && VALID_ROLES.has(r)
  );

  if (!name || !email) {
    return NextResponse.json({ ok: false, message: "Name and email are required." }, { status: 422 });
  }

  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${req.nextUrl.origin}/auth/callback`,
  });
  if (error || !data.user) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Could not invite that user." },
      { status: 500 }
    );
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: data.user.id,
    name,
    email,
    roles,
  });
  if (profileError) {
    return NextResponse.json({ ok: false, message: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
