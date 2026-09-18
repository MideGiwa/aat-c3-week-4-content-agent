// Shared validation rules — see INTAKE-AND-RESEARCH-SPEC.md §1.
//
// Deliberately used from BOTH the client-side form (for instant feedback)
// AND the webhook route handlers that stand in for n8n (for the "never
// trust client-only validation" re-check). Keeping one implementation
// shared here means the two layers can't quietly drift apart — in the real
// system, n8n has its own copy in the workflow itself, but the rules must
// stay identical to what's specified here.

export interface FieldError {
  field: string;
  message: string;
}

const ALLOWED_FILE_EXTENSIONS = [".txt", ".pdf", ".xlsx", ".csv", ".docx"];
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB, per the spec

const MAX_TONE_LENGTH = 40;
const MAX_CUSTOM_CRITERIA = 5;
const MAX_CRITERION_NAME_LENGTH = 60;
const MAX_CRITERION_DESCRIPTION_LENGTH = 300;

export function isGibberish(ideaOrTopic: string): boolean {
  const trimmed = ideaOrTopic.trim();
  if (trimmed.length < 15) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return true;
  return false;
}

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isAllowedFileSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_ATTACHMENT_BYTES;
}

export function isFutureDateTime(iso: string): boolean {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  // Strictly after "now" at the moment this is checked — this function is
  // called again server-side on submit, not just once when the form
  // rendered, precisely so a slow network can't sneak a near-past
  // timestamp through client-side-only validation.
  return parsed.getTime() > Date.now();
}

/** A rubric criterion added at intake for this request only — see
 * src/lib/types.ts's CustomRubricCriterion doc comment. Kept as a plain
 * {name, description} pair here (rather than importing the type) so
 * validation.ts stays dependency-light and usable from both the client
 * form and the server-side re-check. */
export interface NewCustomRubricCriterionInput {
  name: string;
  description: string;
}

export interface NewRequestInput {
  idea_or_topic: string;
  target_audience: string;
  source_url: string;
  tone: string;
  priority_channels: string[];
  publish_timing: "immediately" | "scheduled";
  scheduled_for: string;
  attachment_file_name?: string;
  attachment_size_bytes?: number;
  /** Optional — additive rubric criteria for this request only (DESIGN.md
   * §13). Defaults to none; the UI lets a submitter add up to
   * MAX_CUSTOM_CRITERIA of these when making a new request. */
  custom_rubric_criteria?: NewCustomRubricCriterionInput[];
}

/** The single source of truth for "is this request submittable." Used by
 * the form for inline errors and by the mock webhook handler to simulate
 * n8n's server-side re-validation — see INTAKE-AND-RESEARCH-SPEC.md §1's
 * request field table. */
export function validateNewRequest(input: NewRequestInput): FieldError[] {
  const errors: FieldError[] = [];

  if (isGibberish(input.idea_or_topic)) {
    errors.push({
      field: "idea_or_topic",
      message:
        "Give a bit more detail — at least a few real words describing the idea (not a random string).",
    });
  }

  if (!input.target_audience.trim()) {
    errors.push({ field: "target_audience", message: "Target audience is required." });
  }

  if (input.source_url && !isValidUrl(input.source_url)) {
    errors.push({ field: "source_url", message: "That doesn't look like a valid URL." });
  }

  // Tone is free text now (the dropdown offers presets, but a submitter can
  // type their own — see NewRequestForm's "Other" option), so it needs its
  // own re-check server-side rather than relying on the dropdown having
  // constrained it client-side.
  if (!input.tone.trim()) {
    errors.push({ field: "tone", message: "Tone can't be blank." });
  } else if (input.tone.trim().length > MAX_TONE_LENGTH) {
    errors.push({ field: "tone", message: `Keep tone under ${MAX_TONE_LENGTH} characters.` });
  }

  if (input.custom_rubric_criteria && input.custom_rubric_criteria.length > 0) {
    if (input.custom_rubric_criteria.length > MAX_CUSTOM_CRITERIA) {
      errors.push({
        field: "custom_rubric_criteria",
        message: `Add at most ${MAX_CUSTOM_CRITERIA} custom criteria per request.`,
      });
    }

    const seenNames = new Set<string>();
    input.custom_rubric_criteria.forEach((criterion, i) => {
      const name = criterion.name?.trim() ?? "";
      const description = criterion.description?.trim() ?? "";
      if (!name) {
        errors.push({ field: `custom_rubric_criteria.${i}.name`, message: "Give this custom criterion a name." });
      } else if (name.length > MAX_CRITERION_NAME_LENGTH) {
        errors.push({
          field: `custom_rubric_criteria.${i}.name`,
          message: `Keep criterion names under ${MAX_CRITERION_NAME_LENGTH} characters.`,
        });
      } else {
        const key = name.toLowerCase();
        if (seenNames.has(key)) {
          errors.push({ field: `custom_rubric_criteria.${i}.name`, message: "Criterion names must be unique." });
        }
        seenNames.add(key);
      }
      if (!description) {
        errors.push({
          field: `custom_rubric_criteria.${i}.description`,
          message: "Say what this criterion should check for — that's what it's scored against.",
        });
      } else if (description.length > MAX_CRITERION_DESCRIPTION_LENGTH) {
        errors.push({
          field: `custom_rubric_criteria.${i}.description`,
          message: `Keep the description under ${MAX_CRITERION_DESCRIPTION_LENGTH} characters.`,
        });
      }
    });
  }

  if (input.attachment_file_name && !isAllowedFileName(input.attachment_file_name)) {
    errors.push({
      field: "attachment",
      message: "Only .txt, .pdf, .xlsx, .csv, or .docx files are accepted.",
    });
  }

  if (
    input.attachment_size_bytes !== undefined &&
    !isAllowedFileSize(input.attachment_size_bytes)
  ) {
    errors.push({ field: "attachment", message: "File must be under 20MB." });
  }

  if (input.publish_timing === "scheduled") {
    if (!input.scheduled_for) {
      errors.push({
        field: "scheduled_for",
        message: "Pick a date and time, or switch to 'publish immediately'.",
      });
    } else if (!isFutureDateTime(input.scheduled_for)) {
      errors.push({
        field: "scheduled_for",
        message: "Scheduled time must be in the future.",
      });
    }
  }

  return errors;
}
