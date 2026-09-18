// Plain-fetch Tavily search client. Finds candidate source URLs for a
// request that has no source_url (or to supplement one that does) — each
// result still needs to be scraped (firecrawl.ts) for full text, since
// Tavily's own snippet is too short to draft or cite from directly.
// https://docs.tavily.com/documentation/api-reference/endpoint/search
//
// Tavily is a supplementary source-finder, not a hard dependency — unlike
// Firecrawl (the only thing that can actually retrieve page content, so a
// missing FIRECRAWL_API_KEY genuinely throws), a request that already
// supplies its own source_url can be fully researched without ever calling
// this function's result for anything. A missing key or a failed request is
// therefore treated as "found nothing" (return []), not a fatal error — see
// the 2026-09-17 fix note: this used to throw on a missing key, which sank
// research for EVERY request (even URL-only ones) whenever Tavily wasn't
// configured, since researchAndCurateSources calls this unconditionally.
// The only genuinely irrecoverable case is a request with no source_url and
// no search results — that legitimately has nothing to research from, and
// still surfaces as research_failed once Firecrawl has nothing to scrape.

import { TAVILY_API_KEY } from "../config";

export interface TavilyResult {
  url: string;
  title: string;
}

export async function searchWeb(query: string, maxResults = 4): Promise<TavilyResult[]> {
  if (!TAVILY_API_KEY) {
    console.warn(
      "TAVILY_API_KEY is not set — skipping web search (see .env.example). " +
        "Research will rely on the request's own source_url, if any."
    );
    return [];
  }

  // Same reasoning as firecrawl.ts's scrapeUrl: a non-OK response was
  // already treated as "found nothing" (below), but a network-level
  // failure throws from fetch() itself before any response exists, and
  // was escaping this function uncaught — sinking research entirely
  // instead of just falling back to source_url alone, contrary to this
  // file's own "supplementary, not a hard dependency" doc comment above.
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });

    if (!res.ok) {
      console.error(`Tavily search failed for "${query}": ${res.status} ${await res.text()}`);
      return [];
    }

    const body = await res.json();
    const results: Array<{ url: string; title: string }> = body?.results ?? [];
    return results.map((r) => ({ url: r.url, title: r.title }));
  } catch (err) {
    console.error(`Tavily search failed for "${query}": ${String(err)}`);
    return [];
  }
}
