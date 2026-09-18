// Mock content-generation primitives for the automated pipeline (research →
// curation → planning → drafting → evaluation → revision → channel prep).
//
// This is the mock half of what CONTENT-PIPELINE-SPEC.md describes. Every
// function here is deterministic and template-based — no network calls, no
// Claude API, no Firecrawl/Tavily/Voyage — so the pipeline is runnable with
// zero API keys and produces the same output for the same input. Real mode
// replaces the *insides* of these functions with actual calls (see the
// "Going from mock to real" section of README.md and the real-mode notes
// inline below); nothing that calls into src/lib/pipeline/run.ts needs to
// change when that happens.

import type { ChannelAsset, Channel, ContentRequest, CustomRubricCriterion, Draft, DraftSection, Evaluation, PremiseCheckResult, RubricScore, SourceRef } from "../types";
import { nextId } from "../mock/store";

// Mock stand-in for generate.real.ts's checkIdeaPremise — see that
// function's doc comment for what this screens for, why, and the exact
// line it has to draw (assertion vs. examination, empirical fact vs.
// contested opinion). Mock mode has no real model to ask, so this is
// deterministic keyword matching against a small, explicitly-incomplete
// list of well-known false claims — good enough to demo the "should not
// get past the submit page" behavior end to end, not a real fact-checking
// system. A debunking/examining-intent signal word exempts a match, the
// same way a real classifier would reason about it properly.
const KNOWN_FALSE_CLAIM_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /flat earth|earth is flat/i, category: "flat earth" },
  { pattern: /moon landing (was |is )?(faked|fake|a hoax)/i, category: "moon landing hoax" },
  { pattern: /vaccines? cause[s]? autism/i, category: "vaccine misinformation" },
  { pattern: /holocaust (did not|didn't|never) happen/i, category: "holocaust denial" },
];
const DEBUNK_INTENT_PATTERN = /debunk|myth|misconception|hoax claim|conspiracy theor|why[\s\S]{0,40}\bbelieve/i;

export function checkIdeaPremise(ideaOrTopic: string): PremiseCheckResult {
  if (DEBUNK_INTENT_PATTERN.test(ideaOrTopic)) {
    return { flagged: false, category: null, explanation: "" };
  }
  const match = KNOWN_FALSE_CLAIM_PATTERNS.find((p) => p.pattern.test(ideaOrTopic));
  if (!match) {
    return { flagged: false, category: null, explanation: "" };
  }
  return {
    flagged: true,
    category: match.category,
    explanation: "This directly contradicts well-established scientific/historical consensus.",
  };
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

function titleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => (word.length > 3 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Research + Source Retrieval. Real mode: Firecrawl (scrape request.source_url
 * if provided) + Tavily/Exa (search on idea_or_topic), then Voyage AI
 * embeddings for the chunked results (INTAKE-AND-RESEARCH-SPEC.md §2 —
 * superseded in structure, not in these parameters, by
 * CONTENT-PIPELINE-SPEC.md). Mock mode fabricates 3–4 plausible-looking
 * sources instead, with the last one deliberately marked irrelevant so
 * curation below has something real to reject. */
export function generateSources(request: ContentRequest): SourceRef[] {
  const now = new Date().toISOString();
  const topic = request.idea_or_topic.trim();
  const sources: SourceRef[] = [];

  if (request.source_url) {
    sources.push({
      id: nextId("src"),
      request_id: request.id,
      url: request.source_url,
      title: `Reference material: ${titleCase(topic)}`,
      retrieved_at: now,
      selected: true,
      relevance_note: "Provided directly with the request — treated as a primary source.",
    });
  }

  sources.push(
    {
      id: nextId("src"),
      request_id: request.id,
      url: `https://example-research.com/articles/${slugify(topic)}`,
      title: `Industry brief: ${titleCase(topic)}`,
      retrieved_at: now,
      selected: true,
      relevance_note: `Directly on-topic for "${topic}" — used for the core argument.`,
    },
    {
      id: nextId("src"),
      request_id: request.id,
      url: `https://example-news.com/${slugify(request.target_audience)}-perspective`,
      title: `${titleCase(request.target_audience)}: what's changing`,
      retrieved_at: now,
      selected: true,
      relevance_note: `Grounds the piece in what ${request.target_audience.toLowerCase()} actually care about.`,
    },
    {
      id: nextId("src"),
      request_id: request.id,
      url: "https://example.com/unrelated-listicle",
      title: "Unrelated general-interest listicle",
      retrieved_at: now,
      selected: false,
      relevance_note: "Below the relevance floor during source curation — not specific to this topic.",
    }
  );

  return sources;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

/** Truncates to at most maxLen characters (ellipsis included) without
 * cutting a word in half. A hard `.slice()` used to cut mid-word with no
 * indication anything was cut off — this is what made channel copy read as
 * garbled/unreadable (e.g. "...already. T"). Falls back to a hard cut only
 * if there's no reasonable word boundary to break on. */
function truncateAtWord(text: string, maxLen: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;

  const sliced = trimmed.slice(0, Math.max(0, maxLen - 1));
  const lastSpace = sliced.lastIndexOf(" ");
  const safe = lastSpace > maxLen * 0.4 ? sliced.slice(0, lastSpace) : sliced;
  return `${safe.trimEnd()}…`;
}

/** Planning. Real mode: a Claude call proposing 2+ angles/titles for the
 * same brief (CONTENT-PIPELINE-SPEC.md §3). Mock mode proposes two
 * templated angles and picks one with a simple, explainable heuristic
 * (recorded in the activity log as a "select_option" entry) rather than
 * fully drafting and evaluating both — see CONTENT-PIPELINE-SPEC.md's
 * "Scope decision" note for why. */
export function planTitleOptions(request: ContentRequest): { options: [string, string]; chosenIndex: 0 | 1; reason: string } {
  const topic = titleCase(request.idea_or_topic.trim());
  const optionA = topic.endsWith("?") ? topic : `${topic}: What ${titleCase(request.target_audience)} Need to Know`;
  const optionB = topic.endsWith("?") ? `Is It Time to Rethink ${topic.replace(/\?$/, "")}?` : `${topic}?`;

  // Heuristic: prefer the direct, non-question framing for a professional/
  // authoritative tone (clearer, more citable), and the question framing for
  // a conversational/playful tone (more inviting). This is a stand-in for
  // what would be a Claude judgment call in real mode.
  const preferDirect = request.tone === "professional" || request.tone === "authoritative";
  const chosenIndex: 0 | 1 = preferDirect ? 0 : 1;
  const reason = preferDirect
    ? "Direct framing reads clearer for a professional/authoritative tone and states the payoff up front."
    : "Question framing is more inviting for a conversational/playful tone and matches how the audience would search for this.";

  return { options: [optionA, optionB], chosenIndex, reason };
}

/** Drafting. Real mode: a Claude call producing structured sections from
 * the plan + curated sources (CONTENT-PIPELINE-SPEC.md §4). Mock mode
 * templates 3 sections from the request and selected sources.
 *
 * Deliberate mock behavior: the last section is generated WITHOUT a cited
 * source on the first pass (version 1) — representing a realistic
 * first-draft gap — so the evaluation step below has a real, specific
 * reason to flag it and the revision step has something concrete to fix.
 * This is what makes "revise weak drafts" demonstrable end-to-end instead
 * of every draft trivially passing round 1. */
export function generateDraft(
  request: ContentRequest,
  sources: SourceRef[],
  title: string,
  version: number,
  generatedBy: Draft["generated_by"],
  optionLabel: string = "A"
): Draft {
  const selected = sources.filter((s) => s.selected);
  const primary = selected[0];
  const secondary = selected[1] ?? primary;

  const sections: DraftSection[] = [
    {
      heading: "Why this matters now",
      body: `For ${request.target_audience.toLowerCase()}, "${request.idea_or_topic.trim()}" isn't a hypothetical — it's showing up in day-to-day decisions already. This piece lays out what's actually changing and why it's worth paying attention to.`,
      cited_source_ids: primary ? [primary.id] : [],
    },
    {
      heading: "What the research shows",
      body: `Looking at the available material, the pattern is consistent: this is moving faster than most ${request.target_audience.toLowerCase()} expect, and the organizations paying attention early are adapting with less disruption.`,
      cited_source_ids: secondary ? [secondary.id] : [],
    },
    {
      heading: "What to do next",
      body: `The practical takeaway is straightforward: treat this as a near-term priority, not a someday item. Start with a small, low-risk pilot, measure what actually changes, and expand from there.`,
      cited_source_ids: [], // intentionally uncited on the first pass — see function doc
    },
  ];

  const now = new Date().toISOString();
  return {
    id: nextId("draft"),
    request_id: request.id,
    version,
    option_label: optionLabel,
    title,
    sections,
    generated_by: generatedBy,
    created_at: now,
    updated_at: now,
  };
}

// Common English stopwords stripped out when guessing a "primary keyword"
// from free-text idea_or_topic — see primaryKeyword() below. Not
// exhaustive, just enough to keep the guess from picking an empty word.
const STOPWORDS = new Set([
  "a", "an", "the", "for", "to", "of", "in", "on", "and", "or", "with", "how",
  "what", "why", "when", "is", "are", "this", "that", "your", "you", "we",
  "our", "it", "its", "at", "by", "from", "be", "as", "into", "about",
]);

/** Guesses the SEO "primary keyword" (assets/seo-best-practices.md: "Get
 * the primary keyword from the content idea") from idea_or_topic — the
 * mock's deterministic stand-in for what would be a Claude judgment call
 * in real mode (see generate.real.ts's evaluateDraft, which asks Claude to
 * draw it from `idea_or_topic` directly). Takes the longest 1-2 remaining
 * significant words, on the theory that longer words are more likely to be
 * the specific/distinctive part of the topic rather than a filler word. */
function primaryKeyword(ideaOrTopic: string): string {
  const words = ideaOrTopic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (words.length === 0) return ideaOrTopic.trim().toLowerCase();
  const ranked = [...words].sort((a, b) => b.length - a.length);
  return ranked.slice(0, 2).join(" ");
}

/** Scores "SEO Fit" against assets/seo-best-practices.md's actual checklist
 * instead of a flat placeholder — the gap flagged in the project checklist
 * ("SEO Fit is a flat placeholder score"). Checks what's mechanically
 * checkable from the draft's own shape: keyword placement in the title and
 * opening, H1/H2-equivalent structure (the title plus multiple section
 * headers), and a link/citation count standing in for "2-3 relevant
 * internal or external links." Real mode asks Claude to judge the same
 * checklist directly against the actual prose (see SEO_GUIDELINES in
 * generate.real.ts) — this mock version can only check for the presence of
 * the mechanics, not writing quality, which is the right amount of
 * fidelity for a deterministic template-based mock. */
function scoreSeoFit(request: ContentRequest, draft: Draft): RubricScore {
  const keyword = primaryKeyword(request.idea_or_topic);
  const titleLower = draft.title.toLowerCase();
  const firstSection = draft.sections[0];
  const firstHundredWords = (firstSection?.body ?? "")
    .split(/\s+/)
    .slice(0, 100)
    .join(" ")
    .toLowerCase();

  const totalLinks = new Set(draft.sections.flatMap((s) => s.cited_source_ids)).size;

  const checks: { label: string; pass: boolean }[] = [
    { label: `primary keyword ("${keyword}") appears in the title`, pass: titleLower.includes(keyword) },
    { label: `primary keyword appears in the first ~100 words`, pass: firstHundredWords.includes(keyword) },
    {
      label: "clear H1/H2 structure (a title plus 2+ distinct section headers)",
      pass: draft.sections.length >= 2,
    },
    {
      label: "2+ relevant internal/external links (sources cited across the piece)",
      pass: totalLinks >= 2,
    },
  ];

  const passed = checks.filter((c) => c.pass).length;
  const score = Math.max(2, Math.round((passed / checks.length) * 10));
  const notes = checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.label}`).join(" ");

  return { criterion: "SEO Fit", scope: "default", score, notes };
}

// Words too generic to count as a meaningful signal when checking a custom
// criterion's description against the draft — same idea as STOPWORDS above,
// with a few evaluation-specific fillers added.
const CRITERION_STOPWORDS = new Set([...STOPWORDS, "does", "should", "check", "not", "just", "have", "has"]);

/** Scores one request-specific custom criterion (DESIGN.md §13) by checking
 * how many of its description's significant words actually show up in the
 * draft — an honest, deterministic heuristic rather than a random or flat
 * number, but explicitly labeled as one in its own notes since mock mode
 * has no real language understanding to judge a criterion like "does the
 * hook earn a read" the way a human or Claude actually would. Real mode
 * (generate.real.ts) has Claude score these directly against the prose. */
function scoreCustomCriterion(criterion: CustomRubricCriterion, draft: Draft): RubricScore {
  const draftText = `${draft.title} ${draft.sections.map((s) => `${s.heading} ${s.body}`).join(" ")}`.toLowerCase();
  const terms = Array.from(
    new Set(
      criterion.description
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !CRITERION_STOPWORDS.has(w))
    )
  );

  if (terms.length === 0) {
    return {
      criterion: criterion.name,
      scope: "custom",
      score: 6,
      notes:
        "Mock mode couldn't extract any specific terms from this criterion's description to check for — " +
        "scored at a neutral baseline. A human reviewer should judge this one directly.",
    };
  }

  const matched = terms.filter((t) => draftText.includes(t));
  const score = Math.max(3, Math.min(10, Math.round((matched.length / terms.length) * 10)));

  return {
    criterion: criterion.name,
    scope: "custom",
    score,
    notes:
      `Heuristic check (mock mode) against "${criterion.description}": found ${matched.length}/${terms.length} ` +
      `related term(s) in the draft${matched.length > 0 ? ` (${matched.join(", ")})` : ""}. Real mode has Claude ` +
      "judge this directly instead of matching words.",
  };
}

/** Self-Evaluation against the rubric. Real mode: a Claude call against the
 * default 9-criterion rubric plus any custom criteria added at intake for
 * this request (DESIGN.md §13), returning a schema that's validated and —
 * per the "never fail open" principle — a schema failure is surfaced as an
 * error, never silently treated as a pass (CONTENT-PIPELINE-SPEC.md §5 /
 * the retired LLM-SERVICE-SPEC.md §4).
 *
 * Mock mode scores deterministically from the draft's own shape: a section
 * with no cited source measurably lowers Source Grounding and gets flagged,
 * which is what drives the revision step below — not a random number. SEO
 * Fit and any custom criteria are likewise computed from the draft's actual
 * content (scoreSeoFit / scoreCustomCriterion above), not a flat
 * placeholder. Only Source Grounding drives the pass/revise status and the
 * auto-revision loop, unchanged — SEO/custom scores are informative, not
 * another trigger for a loop that only knows how to fix uncited sections. */
export function evaluateDraft(request: ContentRequest, draft: Draft, round: number): Evaluation {
  const uncitedSections = draft.sections.filter((s) => s.cited_source_ids.length === 0);
  const groundingScore = uncitedSections.length === 0 ? 9 : Math.max(4, 9 - uncitedSections.length * 3);
  const seoScore = scoreSeoFit(request, draft);

  const scores: RubricScore[] = DEFAULT_RUBRIC_CRITERIA.map((criterion) => {
    if (criterion === "Source Grounding") {
      return {
        criterion,
        scope: "default",
        score: groundingScore,
        notes:
          uncitedSections.length === 0
            ? "Every section attributes its claim to a specific source."
            : `${uncitedSections.length} section(s) assert a claim without a cited source.`,
      };
    }
    if (criterion === "SEO Fit") {
      return seoScore;
    }
    if (criterion === "Channel Fit") {
      return { criterion, scope: "default", score: 8, notes: "N/A at article stage — scored per channel after drafting." };
    }
    return { criterion, scope: "default", score: 8, notes: "" };
  });

  for (const custom of request.custom_rubric_criteria ?? []) {
    scores.push(scoreCustomCriterion(custom, draft));
  }

  const unsupportedClaims = uncitedSections.map(
    (s) => `"${s.heading}" makes a claim ("${s.body.slice(0, 60)}...") without a cited source.`
  );

  const status: Evaluation["status"] = groundingScore < 7 ? "revise" : "pass";

  return {
    id: nextId("eval"),
    draft_id: draft.id,
    round,
    status,
    scores,
    unsupported_claims: unsupportedClaims,
    sections_needing_revision: uncitedSections.map((s) => s.heading),
    created_at: new Date().toISOString(),
  };
}

/** Revision. Real mode: a Claude call given the specific evaluation
 * feedback (or a human reviewer's notes) and asked to fix only what was
 * flagged, not regenerate from scratch (CONTENT-PIPELINE-SPEC.md §6).
 * Mock mode: for every section the evaluation flagged as uncited, attaches
 * the best remaining selected source and appends an explicit attribution
 * phrase to the body — the same fix pattern already shown in the seed data
 * (draft-1 → draft-2). If reviewer notes are provided (a human's
 * request_changes), they're appended as an addressed note on the first
 * flagged section so the "what changed and why" is visible in the diff,
 * not just in the activity log. */
export function reviseDraft(
  previous: Draft,
  sources: SourceRef[],
  evaluation: Evaluation,
  generatedBy: Draft["generated_by"],
  reviewerNotes?: string | null
): Draft {
  const selected = sources.filter((s) => s.selected);
  const flaggedHeadings = new Set(evaluation.sections_needing_revision);

  const sections: DraftSection[] = previous.sections.map((section, idx) => {
    if (!flaggedHeadings.has(section.heading)) return section;

    const alreadyCited = new Set(previous.sections.flatMap((s) => s.cited_source_ids));
    const fix = selected.find((s) => !alreadyCited.has(s.id)) ?? selected[0];
    const attribution = fix ? ` This is backed directly by ${fix.title}.` : "";
    const reviewerNote = reviewerNotes && idx === 0 ? ` (Addressed reviewer note: "${reviewerNotes}")` : "";

    return {
      ...section,
      body: `${section.body}${attribution}${reviewerNote}`,
      cited_source_ids: fix ? [...section.cited_source_ids, fix.id] : section.cited_source_ids,
    };
  });

  const now = new Date().toISOString();
  return {
    id: nextId("draft"),
    request_id: previous.request_id,
    version: previous.version + 1,
    option_label: previous.option_label,
    title: previous.title,
    sections,
    generated_by: generatedBy,
    created_at: now,
    updated_at: now,
  };
}

const CHANNEL_CHAR_LIMITS: Record<Channel, number | null> = {
  linkedin: 3000,
  x: 280,
  newsletter: null,
};

/** Channel-specific adaptation ("prepare the selected content for LinkedIn,
 * X, and an email newsletter"). Real mode: a Claude call per channel using
 * that channel's formatting rules (length limits, hashtag/thread
 * conventions, subject-line conventions for the newsletter). Mock mode
 * templates each from the final draft's title and first section.
 *
 * Every requested channel gets an asset here, including newsletter — it's
 * generated and reviewable like any other channel, it just isn't picked up
 * by the n8n publish runner yet (DESIGN.md §11 "Scope note"; see
 * ChannelAssetsPanel in the review UI). Assets are created in "draft"
 * status — a human approving the article promotes them to
 * "ready_to_publish" (src/lib/pipeline/run.ts), which is what makes them
 * eligible for the publish queue. */
export function prepareChannelAssets(request: ContentRequest, draft: Draft): ChannelAsset[] {
  const hook = draft.sections[0] ? truncateAtWord(draft.sections[0].body, 140) : draft.title;

  return request.priority_channels.map((channel) => {
    const limit = CHANNEL_CHAR_LIMITS[channel];
    let content: string;

    if (channel === "linkedin") {
      content = `${draft.title}\n\n${hook}\n\nWhat's your take? Drop a comment below.`;
    } else if (channel === "x") {
      const body = `${draft.title} — ${hook}`;
      content = limit && body.length > limit ? truncateAtWord(body, limit) : body;
    } else {
      // newsletter — headed "## " so it renders as real subheadings in
      // ChannelAssetsPanel's NewsletterPreview (MarkdownText), matching how
      // generate.real.ts's NEWSLETTER_MARKDOWN_RULE now formats the real
      // thing (2026-09-18, user-reported: "newsletter channel copy is not
      // formatted to use md" — LinkedIn/X stay plain text on purpose, since
      // neither platform renders Markdown; a newsletter, sent through an
      // ESP, does).
      content = `Subject: ${draft.title}\n\nHi there,\n\n${draft.sections.map((s) => `## ${s.heading}\n${s.body}`).join("\n\n")}\n\n— Sent via the Content Ops pipeline (draft, not yet distributed).`;
    }

    return {
      id: nextId("ca"),
      request_id: request.id,
      draft_id: draft.id,
      channel,
      content,
      status: "draft",
    };
  });
}
