// Server-only Supabase client, using the secret key (Supabase's replacement
// for the legacy service_role key — same full-privilege role, bypasses RLS
// the same way; see config.ts's doc comment and DESIGN.md's decisions log
// for the 2026-09-17 migration off the legacy anon/service_role naming).
// This is the same trust boundary FRONTEND-SPEC.md describes for every
// write path ("every write happens through this app's own Next.js server
// routes... using a service-role key, bypassing RLS, since they're the
// trusted layer") — that spec predates the key rename, but the boundary
// itself is unchanged. Used by src/lib/supabase/webhooks.ts's real-mode writes
// (system-authored pipeline writes that must bypass RLS), and by two reads
// in src/lib/data.ts that deliberately stay on this client even now that
// Auth is wired up: getProfile()/listProfiles() (profiles has no RLS at
// all, by design — the reviewer picker needs to see everyone) and
// src/app/api/admin/users/route.ts's admin-provisioning writes (both the
// privileged auth.admin.inviteUserByEmail() call and the profiles insert
// that follows it).
//
// Session-scoped reads (listRequests, getRequestDetail) do NOT use this
// client anymore — see src/lib/supabase/routeClient.ts, which is what
// lets supabase/schema.sql's RLS policies actually filter what a given
// logged-in reviewer/submitter/admin can see. This file's client is for
// the reads/writes that are correctly meant to see everything.
//
// Never import this from a "use client" component or anything that ships
// to the browser — SUPABASE_SECRET_KEY must never leave the server.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "../config";

let client: SupabaseClient | null = null;

/** Lazily constructed so importing this module is safe even when
 * USE_MOCK_DATA is true and the env vars are empty — the client is only
 * actually built the first time something calls this in real mode. */
export function getSupabaseServerClient(): SupabaseClient {
  if (client) return client;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Supabase isn't configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY " +
        "(see .env.example) before running with NEXT_PUBLIC_USE_MOCK_DATA=false."
    );
  }

  client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false }, // server-side, one-off client — no session to persist
  });
  return client;
}
