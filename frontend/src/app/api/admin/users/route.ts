// Admin-only user provisioning. There's no public signup page (DESIGN.md's
// auth decisions-log entry) — this is the only way a new account gets
// created in real mode. It does two things atomically-ish: creates the
// actual Supabase Auth user via the Admin API, then inserts the matching
// profiles row with the name/roles this form collected.
//
// Two ways to create the auth user, chosen by whether the request includes
// a password (2026-09-18, user-requested: "Admin should be able to set
// passwords when adding a user from the frontend"):
//   - No password: inviteUserByEmail — creates auth.users AND emails a
//     one-time invite link that establishes their first session. Every
//     sign-in after that goes through the ordinary /login magic-link flow.
//   - Password given: createUser({ password, email_confirm: true }) — no
//     email sent at all. This exists specifically because Supabase's
//     default plan caps outgoing auth emails at 2/hour (the same limit
//     that motivated adding password sign-in to /login in the first
//     place); an admin who's already burned through that quota, or just
//     wants to hand someone working credentials directly, can create an
//     account without consuming another email send.
//
// Requires the secret-key client because auth.admin.* calls are
// privileged — they can't be made with the publishable key at all, session
// or not.

import { NextRequest, NextResponse } from "next/server";
import { USE_MOCK_DATA } from "@/lib/config";
import { getCurrentProfile } from "@/lib/currentUser";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const VALID_ROLES = new Set(["content_manager", "reviewer", "admin"]);
const MIN_PASSWORD_LENGTH = 8;

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
  const password = typeof body.password === "string" ? body.password : "";
  const roles = (Array.isArray(body.roles) ? body.roles : []).filter(
    (r: unknown): r is string => typeof r === "string" && VALID_ROLES.has(r)
  );

  if (!name || !email) {
    return NextResponse.json({ ok: false, message: "Name and email are required." }, { status: 422 });
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 422 }
    );
  }

  const supabase = getSupabaseServerClient();

  const { data, error } = password
    ? await supabase.auth.admin.createUser({ email, password, email_confirm: true })
    : await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${req.nextUrl.origin}/auth/callback`,
      });
  if (error || !data.user) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Could not create that user." },
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

  return NextResponse.json({ ok: true, method: password ? "password" : "invite" });
}
