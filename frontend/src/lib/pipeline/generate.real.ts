// Real-mode content-generation pipeline — Claude for every judgment call
// (planning, drafting, evaluation, revision, channel prep), Firecrawl for
// scraping, Tavily for search, Voyage AI for embeddings. This is what
// src/lib/pipeline/generate.ts's mock functions are template stand-ins for;
// see each mock function's doc comment for the pairing.
//
// Used only by src/lib/supabase/webhooks.ts (the real-mode orchestrator) —
// the mock pipeline (src/lib/pipeline/run.ts + src/lib/mock/webhooks.ts)
// never imports this file, so nothing here can affect the working mock
// demo. Every function assigns its own id via crypto.randomUUID() rather
// than waiting on a database-assigned one — that's what lets a draft's
// cited_source_ids reference a source before either row has actually been
// inserted yet, the same way the mock's nextId() does for the in-memory
// store. The orchestrator is responsible for actually persisting whatever
// these functions return.

import { randomUUID } from "crypto";
import type {
  Channel,
  ChannelAsset,
  ContentRequest,
  CustomRubricCriterion,
  Draft,
  DraftSection,
  Evaluation,
  RubricScore,
  SourceRef,
} from "../types";
import { structuredCall } from "../ai/anthropic";
import { scrapeUrl, type ScrapeFailureReason, type ScrapedPage } from "../ai/firecrawl";
import { searchWeb } from "../ai/tavily";
import { chunkText, embedTexts } from "../ai/voyage";

// Bounds how much of each source's raw_text goes into a prompt — full
// articles across several sources could otherwise blow well past a
// reasonable prompt size. ~6000 chars (~1500 tokens) per source is enough
// for Claude to actually ground claims and check citations against, without
// letting one long source crowd out the others in a multi-source request.
const MAX_SOURCE_EXCERPT_CHARS = 6000;

function sourceExcerpt(source: SourceRef): string {
  return (source.raw_text ?? "").slice(0, MAX_SOURCE_EXCERPT_CHARS);
}

// Domains Firecrawl has told us outright it won't scrape (its "we do not
// support this site" 403 — a policy refusal, not a bot-detection wall; see
// scrapeUrl's doc comment). Checked before ever attempting a scrape so
// these don't waste one of the (up to 6) attempts a request gets — first
// seen live 2026-09-18: reddit.com, instagram.com, threads.com/.net. Add a
// domain here once it's actually been observed refusing (via a
// "unsupported_site" row in stage_logs — see runInitialPipeline), rather
// than guessing ahead of time.
const KNOWN_UNSUPPORTED_DOMAINS = ["reddit.com", "instagram.com", "threads.com", "threads.net"];

function unsupportedDomainFor(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return KNOWN_UNSUPPORTED_DOMAINS.find((d) => hostname === d || hostname.endsWith(`.${d}`)) ?? null;
}

export interface ScrapeFailure {
  url: string;
  reason: ScrapeFailureReason;
  detail: string;
}

const DEFAULT_RUBRIC_CRITERIA = [
  "Topic Relevance",
  "Source Grounding",
  "Factual Consistency",
  "Audience Fit",
  "Tone",
  "SEO Fit",
  "Channel Fit",
  "Clarity",
  "Completeness",
] as const;

// Condensed from assets/content-evaluation-rubric.md — kept inline so the
// evaluation prompt below is self-contained and can't drift from what's
// actually checked in structuredCall's validate step.
const RUBRIC_DESCRIPTION = `
- Topic Relevance: the content answers the request and stays focused on the intended topic.
- Source Grounding: claims, examples, and recommendations connect back to reviewed source material.
- Factual Consistency: no contradictions, unsupported claims, or invented details.
- Audience Fit: speaks to the target audience at the right level of depth.
- Tone: style matches the brand and channel.
- SEO Fit: uses the primary keyword, relevant secondary keywords, clear headings, and useful links.
- Channel Fit: each adapted output follows the platform formatting rules.
- Clarity: easy to read, skimmable, and direct.
- Completeness: includes every required section or channel asset.
`.trim();

// Condensed from assets/seo-best-practices.md.
const SEO_GUIDELINES = `
- Include the primary keyword (drawn from the content idea) in the title and in the first 100 words.
- Use relevant secondary keywords in the body and section headers.
- One H1 (the title), clear section headers, short paragraphs (2-3 sentences).
- Include 2-3 relevant internal or external links where they'd naturally belong.
- Keep claims grounded in the reviewed source material — nothing invented.
`.trim();

// Condensed from assets/channel-formatting-rules.md.
const CHANNEL_FORMATTING_RULES: Record<Channel, string> = {
  linkedin: `
- Use the PAS structure: problem, agitation, solution.
- Keep paragraphs short. Use bullets or simple symbols when they improve clarity.
- A small number of relevant emojis is fine if it fits a professional voice — don't overdo it.
- End with a clear call to action.
`.trim(),
  x: `
- Lead with the main benefit, insight, or hook. One core idea only.
- Use line breaks for readability. No more than 1-2 relevant hashtags.
- Must fit within 280 characters total.
`.trim(),
  newsletter: `
- Strong subject line with a clear benefit or point of intrigue.
- Short intro (1-3 sentences), then a skimmable main section with subheadings or bullets.
- Include a clear call to action and a friendly sign-off.
- Total length between 250 and 600 words.
`.trim(),
};

/** Research & Retrieval + Source Curation (CONTENT-PIPELINE-SPEC.md §1-2),
 * done together the same way the mock does: candidates are gathered
 * (source_url + Tavily search), scraped with Firecrawl, chunked and
 * embedded with Voyage AI, then a single Claude call curates the full set
 * at once — cheaper and more consistent than scoring each source in
 * isolation, and it can weigh sources against each other (e.g. drop a
 * weaker source that's redundant with a stronger one already kept).
 *
 * Returns both the SourceRef rows (matching the mock's contract) and the
 * chunk rows to persist into `source_chunks` — the orchestrator inserts
 * `sources` first (these ids are already valid UUIDs, generated here) and
 * then `source_chunks` referencing them. An empty `sources` array is the
 * real research_failed trigger (EDGE-CASES-AND-GUARDRAILS.md) — the
 * orchestrator checks for that, this function doesn't decide it.
 *
 * Also returns `scrapeFailures` — every candidate URL that didn't become a
 * source, and why (pre-filtered known-unsupported domain, Firecrawl's own
 * refusal, a generic HTTP error, or a network-level failure). The
 * orchestrator persists these to `stage_logs` purely for measurement — see
 * DESIGN.md's 2026-09-18 decisions log entry — this function itself makes
 * no decisions based on them. */
export async function researchAndCurateSources(request: ContentRequest): Promise<{
  sources: SourceRef[];
  chunks: Array<{ id: string; source_id: string; chunk_index: number; chunk_text: string; embedding: number[] }>;
  scrapeFailures: ScrapeFailure[];
}> {
  const now = new Date().toISOString();
  const candidateUrls: string[] = [];
  if (request.source_url) candidateUrls.push(request.source_url);

  const searchResults = await searchWeb(`${request.idea_or_topic} — ${request.target_audience}`, 5);
  for (const r of searchResults) {
    if (!candidateUrls.includes(r.url)) candidateUrls.push(r.url);
  }

  // Filter out domains already known to refuse Firecrawl outright before
  // spending one of the (up to 6) scrape attempts on a guaranteed failure
  // — see KNOWN_UNSUPPORTED_DOMAINS' doc comment. Still recorded as a
  // scrapeFailure so the measurement captures pre-filtered URLs too, not
  // just ones that made it to an actual Firecrawl call.
  const scrapeFailures: ScrapeFailure[] = [];
  const scrapeCandidates: string[] = [];
  for (const url of candidateUrls) {
    const unsupportedDomain = unsupportedDomainFor(url);
    if (unsupportedDomain) {
      scrapeFailures.push({
        url,
        reason: "unsupported_site",
        detail: `Pre-filtered — ${unsupportedDomain} is a known-unsupported domain; not attempted.`,
      });
      continue;
    }
    scrapeCandidates.push(url);
    if (scrapeCandidates.length === 6) break;
  }

  // Promise.allSettled rather than Promise.all: scrapeUrl is written to
  // never throw (it catches its own failures and resolves to an
  // { ok: false } result — see its doc comment), but a single scrape
  // failing this whole batch over one bad URL was a real, live bug
  // (2026-09-18) — allSettled is cheap insurance against that class of bug
  // recurring even if scrapeUrl's own contract ever regresses.
  const scrapeResults = await Promise.allSettled(scrapeCandidates.map((url) => scrapeUrl(url)));
  const scraped: ScrapedPage[] = [];
  scrapeResults.forEach((result, i) => {
    const url = scrapeCandidates[i];
    if (result.status === "fulfilled") {
      if (result.value.ok) {
        scraped.push(result.value.page);
      } else {
        scrapeFailures.push({ url, reason: result.value.reason, detail: result.value.detail });
      }
    } else {
      scrapeFailures.push({ url, reason: "network_error", detail: String(result.reason).slice(0, 500) });
    }
  });

  if (scraped.length === 0) {
    return { sources: [], chunks: [], scrapeFailures };
  }

  const curated = await structuredCall({
    label: "source curation",
    system:
      "You are curating source material for a content piece before it's drafted. For each source, decide whether " +
      "it should be used (selected: true) or excluded (selected: false), and give a one-sentence relevance_note " +
      "explaining why either way — an excluded source still needs a stated reason (e.g. off-topic, too thin, " +
      "redundant with a stronger source already kept). Respond with ONLY a JSON array, one object per source, in " +
      'the exact same order given, each shaped as: {"selected": boolean, "relevance_note": string}. No other text.',
    user: JSON.stringify({
      topic: request.idea_or_topic,
      target_audience: request.target_audience,
      sources: scraped.map((s) => ({ url: s.url, title: s.title, excerpt: s.markdown.slice(0, 1200) })),
    }),
    maxTokens: 1024,
    validate: (json): Array<{ selected: boolean; relevance_note: string }> => {
      if (!Array.isArray(json) || json.length !== scraped.length) {
        throw new Error(`expected a ${scraped.length}-item array from source curation`);
      }
      return json.map((entry) => {
        if (typeof entry?.selected !== "boolean" || typeof entry?.relevance_note !== "string") {
          throw new Error("each curation entry needs boolean `selected` and string `relevance_note`");
        }
        return entry;
      });
    },
  });

  const sources: SourceRef[] = scraped.map((s, i) => ({
    id: randomUUID(),
    request_id: request.id,
    url: s.url,
    title: s.title || s.url,
    retrieved_at: now,
    selected: curated[i].selected,
    relevance_note: curated[i].relevance_note,
    // Kept on every source (selected or not), matching schema.sql's
    // raw_text column comment — this is what generateDraft/evaluateDraft/
    // reviseDraft actually ground claims in and check citations against
    // (2026-09-17 fix: they previously only ever saw title/url/
    // relevance_note, never the source's actual content).
    raw_text: s.markdown,
  }));

  // Chunk + embed only the selected sources — no point spending embedding
  // calls on material curation already decided not to use.
  const chunks: Array<{ id: string; source_id: string; chunk_index: number; chunk_text: string; embedding: number[] }> = [];
  for (let i = 0; i < scraped.length; i++) {
    if (!curated[i].selected) continue;
    const pieces = chunkText(scraped[i].markdown);
    if (pieces.length === 0) continue;
    const embeddings = await embedTexts(pieces);
    pieces.forEach((chunk_text, idx) => {
      chunks.push({
        id: randomUUID(),
        source_id: sources[i].id,
        chunk_index: idx,
        chunk_text,
        embedding: embeddings[idx],
      });
    });
  }

  return { sources, chunks, scrapeFailures };
}

/** Planning (CONTENT-PIPELINE-SPEC.md §3) — a Claude call proposing two
 * title/angle options and picking one, mirroring the mock's shape exactly
 * (same "why only two, why pick automatically" scope decision documented
 * there) but with an actual model judgment instead of a tone-based
 * heuristic. */
export async function planTitleOptions(
  request: ContentRequest
): Promise<{ options: [string, string]; chosenIndex: 0 | 1; reason: string }> {
  const result = await structuredCall({
    label: "planning",
    system:
      "You are planning a piece of content. Propose exactly two distinct title/angle options for the same brief " +
      "(e.g. a direct-statement framing and a question or contrarian framing), then pick the one that best fits the " +
      "requested tone and audience. Respond with ONLY JSON shaped as: " +
      '{"options": [string, string], "chosenIndex": 0 or 1, "reason": string (one sentence explaining the pick)}.',
    user: JSON.stringify({
      idea_or_topic: request.idea_or_topic,
      target_audience: request.target_audience,
      tone: request.tone,
    }),
    maxTokens: 512,
    validate: (json): { options: [string, string]; chosenIndex: 0 | 1; reason: string } => {
      const j = json as { options?: unknown; chosenIndex?: unknown; reason?: unknown };
      if (
        !Array.isArray(j.options) ||
        j.options.length !== 2 ||
        typeof j.options[0] !== "string" ||
        typeof j.options[1] !== "string"
      ) {
        throw new Error("`options` must be a 2-element string array");
      }
      if (j.chosenIndex !== 0 && j.chosenIndex !== 1) {
        throw new Error("`chosenIndex` must be 0 or 1");
      }
      if (typeof j.reason !== "string") {
        throw new Error("`reason` must be a string");
      }
      return { options: [j.options[0], j.options[1]], chosenIndex: j.chosenIndex, reason: j.reason };
    },
  });

  return result;
}

/** Draft Generation (CONTENT-PIPELINE-SPEC.md §4) — a Claude call producing
 * structured sections grounded in the selected sources, following
 * assets/seo-best-practices.md, with every section citing the source
 * id(s) that actually support it. Claude is given each selected source's
 * real id so citations reference something the app can resolve — it's
 * told explicitly not to invent an id. Each source's `excerpt` (its actual
 * scraped text, bounded by sourceExcerpt()) is what the draft is meant to
 * be grounded in — a 2026-09-17 fix: this used to send only title/url/
 * relevance_note, so "grounded in the sources" had nothing but a title and
 * a one-sentence note to actually ground in. */
export async function generateDraft(
  request: ContentRequest,
  sources: SourceRef[],
  title: string,
  version: number,
  generatedBy: Draft["generated_by"],
  optionLabel: string = "A"
): Promise<Draft> {
  const selected = sources.filter((s) => s.selected);

  const result = await structuredCall({
    label: "draft generation",
    system:
      "You are writing an article section-by-section from curated source material. Each source includes an " +
      "`excerpt` of its actual scraped text — base claims and specifics on that text, not on the title or url alone. " +
      "Follow these SEO guidelines:\n" +
      SEO_GUIDELINES +
      "\n\nEvery claim must cite the id of a source it's actually grounded in — use only the ids provided, never " +
      "invent one, and leave cited_source_ids empty only if a section genuinely isn't grounded in any specific " +
      "source (this should be rare). Respond with ONLY JSON shaped as: " +
      '{"sections": [{"heading": string, "body": string, "cited_source_ids": string[]}, ...]} — 3 to 5 sections.',
    user: JSON.stringify({
      title,
      idea_or_topic: request.idea_or_topic,
      target_audience: request.target_audience,
      tone: request.tone,
      sources: selected.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        relevance_note: s.relevance_note,
        excerpt: sourceExcerpt(s),
      })),
    }),
    maxTokens: 3072,
    validate: (json): DraftSection[] => {
      const j = json as { sections?: unknown };
      if (!Array.isArray(j.sections) || j.sections.length === 0) {
        throw new Error("`sections` must be a non-empty array");
      }
      const validIds = new Set(selected.map((s) => s.id));
      return j.sections.map((raw) => {
        const s = raw as { heading?: unknown; body?: unknown; cited_source_ids?: unknown };
        if (typeof s.heading !== "string" || typeof s.body !== "string" || !Array.isArray(s.cited_source_ids)) {
          throw new Error("each section needs string heading/body and a cited_source_ids array");
        }
        // Drop any hallucinated id rather than fail the whole draft over
        // it — an invented citation is worse than an honestly-uncited
        // section, which the evaluation step below will correctly flag.
        const cited_source_ids = s.cited_source_ids.filter(
          (id): id is string => typeof id === "string" && validIds.has(id)
        );
        return { heading: s.heading, body: s.body, cited_source_ids };
      });
    },
  });

  const generatedAt = new Date().toISOString();
  return {
    id: randomUUID(),
    request_id: request.id,
    version,
    option_label: optionLabel,
    title,
    sections: result,
    updated_at: generatedAt,
    generated_by: generatedBy,
    created_at: generatedAt,
  };
}

/** Self-Evaluation (CONTENT-PIPELINE-SPEC.md §5) — a Claude call scoring
 * the draft against the full rubric (assets/content-evaluation-rubric.md),
 * PLUS:
 *  - the actual SEO checklist (assets/seo-best-practices.md, via
 *    SEO_GUIDELINES) for the "SEO Fit" criterion specifically, rather than
 *    the one-line description in RUBRIC_DESCRIPTION alone — closing the
 *    "SEO Fit is a flat placeholder score" gap the mock had (generate.ts's
 *    scoreSeoFit is the mock's own fix for the same gap);
 *  - any custom criteria added at intake for this request (DESIGN.md §13),
 *    scored in the same call, appended after the 9 defaults and tagged
 *    `scope: "custom"` in the output.
 * "Never fail open": structuredCall throws on a malformed response rather
 * than this function catching it and returning a synthetic pass — a
 * caller that wants to handle that has to do so explicitly. */
export async function evaluateDraft(
  request: ContentRequest,
  draft: Draft,
  sources: SourceRef[],
  round: number
): Promise<Evaluation> {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const selected = sources.filter((s) => s.selected);
  const customCriteria: CustomRubricCriterion[] = request.custom_rubric_criteria ?? [];
  const totalCriteria = DEFAULT_RUBRIC_CRITERIA.length + customCriteria.length;

  const customCriteriaBlock =
    customCriteria.length > 0
      ? "\n\nAlso score these request-specific custom criteria, additive on top of the 9 defaults above " +
        "(DESIGN.md §13) — list them AFTER the 9 defaults, in this exact order:\n" +
        customCriteria.map((c, i) => `${i + 1}. ${c.name}: ${c.description}`).join("\n")
      : "";

  const result = await structuredCall({
    label: "self-evaluation",
    system:
      "You are evaluating a draft against this rubric:\n" +
      RUBRIC_DESCRIPTION +
      "\n\nFor \"SEO Fit\" specifically, check the draft against this checklist rather than judging it loosely:\n" +
      SEO_GUIDELINES +
      "\n`idea_or_topic` (in the input) is what the primary keyword should be drawn from." +
      customCriteriaBlock +
      "\n\nEach section lists the sources it cites, each with that source's actual excerpt — check the claims " +
      "against those excerpts (that's what 'Source Grounding' and 'Factual Consistency' mean here), not just " +
      "whether a citation is present. `available_sources` are every selected source, in case a section is missing " +
      "a citation it should have had. Score each criterion 0-10. List any unsupported or weak claims (quote them) " +
      "and which section headings need revision. Respond with ONLY JSON shaped as: " +
      '{"status": "pass" | "revise" | "reject", ' +
      `"scores": [{"criterion": string, "score": number, "notes": string}, ...] (exactly ${totalCriteria} entries — ` +
      `the ${DEFAULT_RUBRIC_CRITERIA.length} default criteria first, in the order given` +
      (customCriteria.length > 0 ? `, then the ${customCriteria.length} custom criteria in the order given` : "") +
      '), "unsupported_claims": string[], "sections_needing_revision": string[]}.',
    user: JSON.stringify({
      idea_or_topic: request.idea_or_topic,
      title: draft.title,
      sections: draft.sections.map((s) => ({
        heading: s.heading,
        body: s.body,
        cited_sources: s.cited_source_ids.map((id) => {
          const src = sourceById.get(id);
          return { title: src?.title ?? id, excerpt: src ? sourceExcerpt(src) : "" };
        }),
      })),
      available_sources: selected.map((s) => ({ id: s.id, title: s.title, excerpt: sourceExcerpt(s) })),
    }),
    maxTokens: 2048,
    validate: (json): {
      status: Evaluation["status"];
      scores: RubricScore[];
      unsupported_claims: string[];
      sections_needing_revision: string[];
    } => {
      const j = json as {
        status?: unknown;
        scores?: unknown;
        unsupported_claims?: unknown;
        sections_needing_revision?: unknown;
      };
      if (j.status !== "pass" && j.status !== "revise" && j.status !== "reject") {
        throw new Error('`status` must be "pass", "revise", or "reject"');
      }
      if (!Array.isArray(j.scores) || j.scores.length !== totalCriteria) {
        throw new Error(`\`scores\` must have exactly ${totalCriteria} entries`);
      }
      const scores: RubricScore[] = j.scores.map((raw, i) => {
        const s = raw as { criterion?: unknown; score?: unknown; notes?: unknown };
        if (typeof s.score !== "number" || typeof s.notes !== "string") {
          throw new Error("each score needs a numeric `score` and string `notes`");
        }
        const isCustom = i >= DEFAULT_RUBRIC_CRITERIA.length;
        const fallbackCriterion = isCustom
          ? customCriteria[i - DEFAULT_RUBRIC_CRITERIA.length]?.name ?? "Custom criterion"
          : DEFAULT_RUBRIC_CRITERIA[i];
        return {
          criterion: typeof s.criterion === "string" ? s.criterion : fallbackCriterion,
          scope: isCustom ? "custom" : "default",
          score: s.score,
          notes: s.notes,
        };
      });
      if (!Array.isArray(j.unsupported_claims) || !j.unsupported_claims.every((c) => typeof c === "string")) {
        throw new Error("`unsupported_claims` must be a string array");
      }
      if (
        !Array.isArray(j.sections_needing_revision) ||
        !j.sections_needing_revision.every((c) => typeof c === "string")
      ) {
        throw new Error("`sections_needing_revision` must be a string array");
      }
      return {
        status: j.status,
        scores,
        unsupported_claims: j.unsupported_claims,
        sections_needing_revision: j.sections_needing_revision,
      };
    },
  });

  return {
    id: randomUUID(),
    draft_id: draft.id,
    round,
    status: result.status,
    scores: result.scores,
    unsupported_claims: result.unsupported_claims,
    sections_needing_revision: result.sections_needing_revision,
    created_at: new Date().toISOString(),
  };
}

/** Revision (CONTENT-PIPELINE-SPEC.md §6) — a Claude call asked to fix
 * ONLY the sections the evaluation (or a human reviewer) flagged, leaving
 * everything else untouched, so a diff against the previous version stays
 * meaningful. */
export async function reviseDraft(
  previous: Draft,
  sources: SourceRef[],
  evaluation: Evaluation,
  generatedBy: Draft["generated_by"],
  reviewerNotes?: string | null
): Promise<Draft> {
  const selected = sources.filter((s) => s.selected);
  const flagged = new Set(evaluation.sections_needing_revision);

  if (flagged.size === 0) {
    // Nothing flagged — return the draft as a new version unchanged, same
    // as the mock would with an empty sections_needing_revision list.
    const now = new Date().toISOString();
    return { ...previous, id: randomUUID(), version: previous.version + 1, generated_by: generatedBy, created_at: now, updated_at: now };
  }

  const result = await structuredCall({
    label: "revision",
    system:
      "You are revising specific sections of an existing draft. You are given the FULL draft for context but must " +
      "return ONLY the flagged sections, rewritten to fix the stated problem (an unsupported claim, a request for " +
      "the reviewer's specific note, etc.) — grounded in the provided sources, citing their ids. Do not touch " +
      "unflagged sections. Respond with ONLY JSON shaped as: " +
      '{"revised_sections": [{"heading": string, "body": string, "cited_source_ids": string[]}, ...]} — one entry ' +
      "per flagged heading, in any order, each heading matching one of the flagged headings exactly.",
    user: JSON.stringify({
      full_draft: previous.sections,
      flagged_headings: Array.from(flagged),
      unsupported_claims: evaluation.unsupported_claims,
      reviewer_notes: reviewerNotes ?? null,
      available_sources: selected.map((s) => ({ id: s.id, title: s.title, excerpt: sourceExcerpt(s) })),
    }),
    maxTokens: 2048,
    validate: (json): Map<string, DraftSection> => {
      const j = json as { revised_sections?: unknown };
      if (!Array.isArray(j.revised_sections)) {
        throw new Error("`revised_sections` must be an array");
      }
      const validIds = new Set(selected.map((s) => s.id));
      const map = new Map<string, DraftSection>();
      for (const raw of j.revised_sections) {
        const s = raw as { heading?: unknown; body?: unknown; cited_source_ids?: unknown };
        if (typeof s.heading !== "string" || typeof s.body !== "string" || !Array.isArray(s.cited_source_ids)) {
          throw new Error("each revised section needs string heading/body and a cited_source_ids array");
        }
        const cited_source_ids = s.cited_source_ids.filter(
          (id): id is string => typeof id === "string" && validIds.has(id)
        );
        map.set(s.heading, { heading: s.heading, body: s.body, cited_source_ids });
      }
      return map;
    },
  });

  const sections = previous.sections.map((section) => result.get(section.heading) ?? section);

  const revisedAt = new Date().toISOString();
  return {
    id: randomUUID(),
    request_id: previous.request_id,
    version: previous.version + 1,
    option_label: previous.option_label,
    title: previous.title,
    sections,
    generated_by: generatedBy,
    created_at: revisedAt,
    updated_at: revisedAt,
  };
}

/** Channel Adaptation (CONTENT-PIPELINE-SPEC.md §9) — a Claude call per
 * channel using assets/channel-formatting-rules.md's actual rules (PAS for
 * LinkedIn, hashtag/length limits for X, subject+intro+CTA+word-count for
 * the newsletter) rather than the mock's fixed template. Every requested
 * channel gets an asset, including newsletter — same "generated but not
 * auto-published yet" scope as mock mode (DESIGN.md §11). */
export async function prepareChannelAssets(request: ContentRequest, draft: Draft): Promise<ChannelAsset[]> {
  const assets = await Promise.all(
    request.priority_channels.map(async (channel) => {
      const content = await structuredCall({
        label: `channel prep (${channel})`,
        system:
          `You are adapting an article into a ${channel === "x" ? "X (Twitter)" : channel} post. Follow these rules:\n` +
          CHANNEL_FORMATTING_RULES[channel] +
          '\n\nRespond with ONLY JSON shaped as: {"content": string} — the finished post text, ready to publish as-is.',
        user: JSON.stringify({
          title: draft.title,
          sections: draft.sections.map((s) => ({ heading: s.heading, body: s.body })),
        }),
        maxTokens: 1024,
        validate: (json): string => {
          const j = json as { content?: unknown };
          if (typeof j.content !== "string" || j.content.trim().length === 0) {
            throw new Error("`content` must be a non-empty string");
          }
          if (channel === "x" && j.content.length > 280) {
            throw new Error(`X content must be ≤280 characters, got ${j.content.length}`);
          }
          return j.content;
        },
      });

      return {
        id: randomUUID(),
        request_id: request.id,
        draft_id: draft.id,
        channel,
        content,
        status: "draft" as const,
      };
    })
  );

  return assets;
}
