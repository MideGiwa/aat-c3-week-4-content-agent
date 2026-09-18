// "Who is making this request" — the one thing every write path and every
// role check needs, resolved differently per mode:
//
// - Mock mode: there's no real session to read, so the whole app acts as
//   MOCK_CURRENT_PROFILE_ID (src/lib/config.ts), same as it always has.
// - Real mode: whoever Supabase Auth's session cookie says is logged in.
//   middleware.ts is what actually enforces "you must be logged in" for
//   every route except /login and /auth/callback — this file only answers
//   "who is it," not "are they allowed here," so it can return null (e.g.
//   while rendering /login itself, before a session exists).
//
// Safe to call from both Server Components and Route Handlers — both
// contexts support next/headers' cookies(), which is all
// getSupabaseRouteClient() needs.

import { MOCK_CURRENT_PROFILE_ID, USE_MOCK_DATA } from "./config";
import { getProfile } from "./data";
import { getSupabaseRouteClient } from "./supabase/routeClient";
import type { Profile } from "./types";

export async function getCurrentProfileId(): Promise<string | null> {
  if (USE_MOCK_DATA) return MOCK_CURRENT_PROFILE_ID;

  const supabase = getSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const id = await getCurrentProfileId();
  if (!id) return null;
  return getProfile(id);
}
