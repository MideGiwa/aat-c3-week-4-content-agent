export const USE_MOCK_DATA =
  process.env.NEXT_PUBLIC_USE_MOCK_DATA !== "false";

// Discord notifications for pipeline lifecycle events (generation ready for
// review, pipeline failures) — src/lib/discord.ts. Optional: unset in any
// environment where notifications aren't wanted (e.g. local dev), and
// notifyDiscord() no-ops rather than erroring.
export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Supabase's current key system (the legacy `anon`/`service_role` JWTs are
// being retired by end of 2026 — see DESIGN.md's decisions log for
// 2026-09-17's migration to these). The publishable key is the client-safe
// one (ships to the browser, same low privileges the anon key had); the
// secret key is the server-only, full-privilege one (same role the
// service_role key had) — see src/lib/supabase/server.ts's doc comment.
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

// Real-mode pipeline (src/lib/pipeline/generate.real.ts). All unused while
// USE_MOCK_DATA is true — nothing reads these in mock mode.
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
// A smaller/cheaper model for narrow, fast judgment calls that don't need
// the main pipeline model's full reasoning — right now just the intake-time
// premise check (generate.real.ts's checkIdeaPremise, 2026-09-18,
// user-requested: "use a smaller model for that check"). Defaults to a
// stable Haiku model id; swap for whichever current small model your
// account has access to.
//
// 2026-09-18: the original default here, "claude-3-5-haiku-20241022", was
// retired by Anthropic on 2026-02-19 (deprecation announced 2025-12-19) and
// now 404s on every call with `not_found_error` — hit live on Vercel via
// checkIdeaPremise. Anthropic's own deprecations table names
// "claude-haiku-4-5-20251001" as the direct migration target, so that's the
// new default. Pin a dated snapshot here (not the "claude-haiku-4-5" alias)
// so a future Anthropic-side model swap under that alias can't silently
// change this call's behavior without a deliberate version bump.
export const ANTHROPIC_FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5-20251001";
export const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? "";
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? "";
export const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "";
export const VOYAGE_EMBEDDING_MODEL = process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3-lite";

// Mirrors the "current user" that Supabase Auth would otherwise provide.
// In mock mode there's no real auth session, so the whole app acts as this
// one profile — a content manager who is also a reviewer, so both flows
// are reachable without needing to model multiple logged-in users yet.
export const MOCK_CURRENT_PROFILE_ID = "profile-mide";
