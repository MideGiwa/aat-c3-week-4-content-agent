// Auth gate for real mode. Mock mode has no session to check and stays
// exactly as open as it always was (nothing here changes when
// NEXT_PUBLIC_USE_MOCK_DATA=true) — this only activates once real mode is
// actually flipped on.
//
// This is deliberately a SEPARATE Supabase client construction from
// src/lib/supabase/routeClient.ts, even though both are "session-aware."
// Middleware gets its cookies from NextRequest/NextResponse, not
// next/headers' cookies() (that only works inside a Server Component or
// Route Handler) — @supabase/ssr's own docs call for two distinct helpers
// for exactly this reason. Middleware is also the one place that's always
// allowed to persist a refreshed session cookie, which is why this is what
// actually keeps a long-lived login working, not routeClient.ts's
// best-effort (try/catch'd) cookie writes.
//
// Anyone without a session is redirected to /login (remembering where they
// were headed via ?next=); anyone already logged in who lands on /login is
// bounced straight to /board instead of seeing the sign-in form again.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, USE_MOCK_DATA } from "./lib/config";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function middleware(request: NextRequest) {
  if (USE_MOCK_DATA) return NextResponse.next();

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && request.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/board", request.url));
  }

  return response;
}

export const config = {
  // Everything except static assets — those never need an auth check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
