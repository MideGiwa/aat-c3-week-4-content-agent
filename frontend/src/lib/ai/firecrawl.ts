// Plain-fetch Firecrawl client (no SDK dependency — the REST surface used
// here is small enough that a hand-rolled client is easier to audit than
// pulling in another package). Scrapes a single URL into clean markdown,
// stripped of nav/ads/boilerplate. https://docs.firecrawl.dev/api-reference/endpoint/scrape

import { FIRECRAWL_API_KEY } from "../config";

export interface ScrapedPage {
  url: string;
  title: string;
  markdown: string;
}

// "unsupported_site" is Firecrawl's own refusal to even attempt a URL
// (its 403 body literally says "we do not support this site") — a
// deliberate product/policy decision on Firecrawl's part, seen live for
// Reddit, Instagram, and Threads (2026-09-18). That's a different thing
// from "http_error" (the target responded, just not with something
// scrapable — 404, timeout, a non-403 block) or "network_error" (the
// request never got a response at all — DNS, connection reset, TLS).
// Distinguishing them is what lets researchAndCurateSources' scrapeFailures
// answer "how often is the ideal source a platform we can't scrape at
// all" instead of lumping every kind of failure together.
export type ScrapeFailureReason = "unsupported_site" | "http_error" | "network_error";

export type ScrapeResult =
  | { ok: true; page: ScrapedPage }
  | { ok: false; reason: ScrapeFailureReason; detail: string };

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is not set — see .env.example.");
  }

  // Everything from here down must resolve to an { ok: false } result on
  // failure, never throw — a single dead/unreachable/blocked source
  // shouldn't sink the whole research step (this function is called once
  // per candidate URL, in parallel, from researchAndCurateSources's
  // Promise.allSettled). That used to only be true for a non-OK HTTP
  // response (handled below); a network-level failure — DNS, connection
  // reset, TLS error, a host that refuses the connection outright — throws
  // from fetch() itself before a response even exists, and was escaping
  // uncaught, failing every source in the batch over one bad URL (found
  // live: Reddit blocking Firecrawl's scraper entirely). The try/catch
  // here is what actually makes the "one dead source doesn't sink
  // research" promise true in practice.
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      // A total absence of usable sources is what actually triggers
      // research_failed (EDGE-CASES-AND-GUARDRAILS.md), not one bad URL.
      console.error(`Firecrawl scrape failed for ${url}: ${res.status} ${bodyText}`);
      const reason: ScrapeFailureReason =
        res.status === 403 && bodyText.toLowerCase().includes("do not support this site")
          ? "unsupported_site"
          : "http_error";
      return { ok: false, reason, detail: `${res.status} ${bodyText}`.slice(0, 500) };
    }

    const body = await res.json();
    const markdown: string | undefined = body?.data?.markdown;
    const title: string | undefined = body?.data?.metadata?.title;
    if (!markdown) {
      return { ok: false, reason: "http_error", detail: "Firecrawl returned no markdown content." };
    }

    return { ok: true, page: { url, title: title ?? url, markdown } };
  } catch (err) {
    console.error(`Firecrawl scrape failed for ${url}: ${String(err)}`);
    return { ok: false, reason: "network_error", detail: String(err).slice(0, 500) };
  }
}
