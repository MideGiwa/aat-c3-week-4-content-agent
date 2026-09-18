import { NextRequest, NextResponse } from "next/server";
import { USE_MOCK_DATA } from "@/lib/config";
import { getSupabaseRouteClient } from "@/lib/supabase/routeClient";

// Password sign-in, alongside the existing magic-link flow. Unlike magic
// link, this needs no callback round trip: signInWithPassword returns a
// session immediately, and getSupabaseRouteClient() (the same @supabase/ssr
// cookie-aware client /auth/callback and request-magic-link use) persists
// it to a cookie directly on this response. The client just redirects to
// its destination once { ok: true } comes back.
export async function POST(req: NextRequest) {
  if (USE_MOCK_DATA) {
    return NextResponse.json({ ok: false, message: "Not available in mock mode." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ ok: false, message: "Enter your email and password." }, { status: 422 });
  }

  const supabase = getSupabaseRouteClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
