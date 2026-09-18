// Thin wrapper around the Claude API for the real-mode pipeline
// (src/lib/pipeline/generate.real.ts). Every pipeline call that needs a
// judgment call — planning, drafting, evaluation, revision, channel prep —
// goes through structuredCall() below, which asks for JSON matching a
// schema and validates the response before returning it.
//
// "Never fail open" (CONTENT-PIPELINE-SPEC.md / the retired
// LLM-SERVICE-SPEC.md §4): if Claude's response doesn't parse as JSON, or
// doesn't match the expected shape, this throws — it never silently
// returns something that looks like a pass/empty result. A caller that
// wants graceful degradation has to catch and decide that explicitly; nothing
// here decides it for them.

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } from "../config";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — see .env.example.");
  }
  client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

/** Asks Claude for a single JSON object matching `validate`'s expectations
 * and returns the validated, typed result. Retries once on a parse/validate
 * failure (asking Claude to fix its own output) before giving up — a
 * single transient malformed response shouldn't fail an entire pipeline
 * run when a one-line nudge fixes it. */
export async function structuredCall<Out>(opts: {
  label: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Overrides ANTHROPIC_MODEL for this call — e.g. ANTHROPIC_FAST_MODEL
   * for a narrow, cheap judgment call that doesn't need the main pipeline
   * model's full reasoning (2026-09-18, checkIdeaPremise being the first
   * caller). Defaults to ANTHROPIC_MODEL when omitted. */
  model?: string;
  validate: (json: unknown) => Out;
}): Promise<Out> {
  const anthropic = getClient();
  let lastError: unknown;
  // Kept alongside lastError so a final failure can report not just the
  // parse/validation exception but what Claude actually sent back — a bare
  // "Unterminated string in JSON at position N" is useless for telling a
  // transient truncation apart from the model returning prose, a refusal,
  // or a genuinely malformed field, and there's no other record of the raw
  // response once this throws.
  let lastRaw = "";
  let lastStopReason: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote =
      attempt === 0
        ? ""
        : `\n\nYour previous response could not be parsed as valid JSON matching the requested shape (${String(
            lastError
          )}). Reply with ONLY the corrected JSON object this time — no prose, no markdown fences.`;

    const response = await anthropic.messages.create({
      model: opts.model ?? ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.user + retryNote }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";
    lastRaw = raw;
    lastStopReason = response.stop_reason;

    try {
      const jsonText = extractJson(raw);
      const parsed = JSON.parse(jsonText);
      return opts.validate(parsed);
    } catch (err) {
      lastError = err;
    }
  }

  const snippet = lastRaw.length > 500 ? `${lastRaw.slice(0, 500)}…[${lastRaw.length} chars total]` : lastRaw;
  throw new Error(
    `structuredCall(${opts.label}) failed after retry: ${String(lastError)} ` +
      `(stop_reason=${lastStopReason ?? "unknown"}, raw response: ${JSON.stringify(snippet)})`
  );
}

/** Claude's structured-output calls are asked to return ONLY JSON, but this
 * strips a markdown code fence defensively in case one slips through. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}
