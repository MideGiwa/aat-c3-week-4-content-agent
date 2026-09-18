// Browser-side Supabase client — publishable key only (client-safe by
// design, safe to ship to the client bundle). Used exclusively by the
// /login page (LoginForm) to call auth.signInWithOtp(). Nothing else in
// the app needs a browser client: every other Supabase call happens
// server-side (routeClient.ts for session-aware reads, supabase/server.ts's
// secret-key client for writes), per FRONTEND-SPEC.md's "browser never
// talks to Supabase directly except to sign in" boundary.

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
