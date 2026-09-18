// Session-aware Supabase client for Server Components and Route Handlers —
// the RLS-respecting counterpart to server.ts's secret-key client. Built
// with the publishable key + the request's own cookies, so every query this
// client makes runs as whichever user is actually logged in (auth.uid()
// resolves to their session), and supabase/schema.sql's SELECT policies —
// inert until Auth existed — now actually filter what comes back.
//
// Used by: src/lib/currentUser.ts (who's logged in) and src/lib/data.ts's
// listRequests()/getRequestDetail() (so a reviewer only ever sees requests
// they're allowed to see, per RLS, instead of every request via the
// secret-key client). Writes still go through the secret-key client
// (src/lib/supabase/webhooks.ts) — that half of the trust boundary
// (FRONTEND-SPEC.md "every write happens through this app's own trusted
// server routes") doesn't change; this file only changes how *reads*
// authenticate.
//
// Cookie writes here are wrapped in try/catch because a Server Component's
// render can call this and attempt to refresh an expiring session token,
// but Next.js only allows setting cookies from a Route Handler, Server
// Action, or Middleware — not from a component's render. middleware.ts is
// what actually persists a refreshed session cookie; a Server Component
// that can't write one just re-reads the same (still-valid) cookie next
// request. This is the standard @supabase/ssr App Router pattern.

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

export function getSupabaseRouteClient() {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component render — see module doc above.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Called from a Server Component render — see module doc above.
        }
      },
    },
  });
}
