// Where a magic-link email actually lands. Supabase appends a `code` param
// to emailRedirectTo (see LoginForm) — this exchanges it for a real session
// and sets the session cookie, which is why this has to be a Route Handler
// (only Route Handlers, Server Actions, and middleware may set cookies) and
// not, say, a Server Component the link could point at directly.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase/routeClient";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/board";

  if (code) {
    const supabase = getSupabaseRouteClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
