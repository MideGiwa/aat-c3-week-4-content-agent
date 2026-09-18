import { NextRequest, NextResponse } from "next/server";
import { USE_MOCK_DATA } from "@/lib/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseRouteClient } from "@/lib/supabase/routeClient";

// Explicit existence check before ever calling signInWithOtp, rather than
// relying on that call's own shouldCreateUser:false behavior alone — an
// unprovisioned email gets a clear, immediate error here and no email is
// ever sent for it.
export async function POST(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ ok: false, message: "Not available in mock mode." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const redirectTo = typeof body?.redirectTo === "string" ? body.redirectTo : undefined;

  if (!email) {
    return NextResponse.json({ ok: false, message: "Enter your email." }, { status: 422 });
  }

  const admin = getSupabaseServerClient();
  const { data: profile, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json(
      { ok: false, message: "No account found for that email. Contact your administrator for access." },
      { status: 404 }
    );
  }

  // Use the cookie-aware @supabase/ssr client here, not a plain
  // @supabase/supabase-js createClient. The plain client defaults to
  // implicit-flow auth links (a #access_token=... hash fragment that never
  // reaches the server), which /auth/callback can't do anything with since
  // it only handles a PKCE `?code=` param — the browser was left carrying a
  // stale hash fragment through the resulting redirect back to /login.
  // getSupabaseRouteClient() defaults to PKCE and persists the code_verifier
  // to a cookie on this response, so the emailed link carries a `?code=`
  // that /auth/callback's exchangeCodeForSession(code) can actually use.
  const supabase = getSupabaseRouteClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
