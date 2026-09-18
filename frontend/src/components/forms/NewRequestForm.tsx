"use client";

// Submit Request flow (FRONTEND-SPEC.md "Flow 1"). Validates client-side
// with the exact same rules the server re-checks (src/lib/validation.ts),
// purely for instant feedback — the POST below is what actually decides
// whether the request is created, since client-side checks can always be
// bypassed or skipped by a slow/flaky network.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Channel, Profile } from "@/lib/types";
import { validateNewRequest, type FieldError, type NewRequestInput } from "@/lib/validation";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "newsletter", label: "Newsletter" },
];

const CUSTOM_TONE_OPTION = "__custom__";
const MAX_CUSTOM_CRITERIA = 5;

interface CustomCriterionDraft {
  name: string;
  description: string;
}

export default function NewRequestForm({
  profiles,
  currentProfileId,
}: {
  profiles: Profile[];
  currentProfileId: string;
}) {
  const router = useRouter();

  const [ideaOrTopic, setIdeaOrTopic] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [toneOption, setToneOption] = useState("professional");
  const [customTone, setCustomTone] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["linkedin", "x", "newsletter"]);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [customCriteria, setCustomCriteria] = useState<CustomCriterionDraft[]>([]);

  // The tone actually submitted: the preset value, or whatever was typed
  // into the "Other" field when that's selected. Computed rather than kept
  // as its own bit of state so there's only one source of truth for what
  // "the tone" is at submit time.
  const tone = toneOption === CUSTOM_TONE_OPTION ? customTone : toneOption;

  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reviewerCandidates = profiles.filter(
    (p) => p.id !== currentProfileId && p.roles.includes("reviewer")
  );

  function errorFor(field: string): string | undefined {
    return errors.find((e) => e.field === field)?.message;
  }

  function toggleChannel(channel: Channel) {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  }

  function toggleReviewer(id: string) {
    setReviewerIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  function addCustomCriterion() {
    setCustomCriteria((prev) =>
      prev.length >= MAX_CUSTOM_CRITERIA ? prev : [...prev, { name: "", description: "" }]
    );
  }

  function updateCustomCriterion(index: number, field: "name" | "description", value: string) {
    setCustomCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function removeCustomCriterion(index: number) {
    setCustomCriteria((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Drop rows the user added but never filled in (either field still
    // blank) rather than forcing them to explicitly delete an empty row —
    // anything half-filled still goes to validation as a real error below.
    const criteriaToSubmit = customCriteria.filter((c) => c.name.trim() || c.description.trim());

    const input: NewRequestInput = {
      idea_or_topic: ideaOrTopic,
      target_audience: targetAudience,
      source_url: sourceUrl,
      tone,
      priority_channels: channels,
      // Publish timing isn't decided here anymore — a request's fate isn't
      // known yet at submission, and the PRD's own ordering is "review,
      // THEN publish or schedule." It's chosen at approval time instead
      // (see ReviewActions), so this always goes in as "immediately" and
      // the server ignores it in favor of what approval sets.
      publish_timing: "immediately",
      scheduled_for: "",
      attachment_file_name: attachmentFile?.name,
      attachment_size_bytes: attachmentFile?.size,
      custom_rubric_criteria: criteriaToSubmit,
    };

    const clientErrors = validateNewRequest(input);
    if (channels.length === 0) {
      clientErrors.push({ field: "priority_channels", message: "Pick at least one channel." });
    }
    if (clientErrors.length > 0) {
      setErrors(clientErrors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/webhooks/content-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, reviewer_ids: reviewerIds }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErrors(body.errors ?? []);
        if (!body.errors) {
          setSubmitError("Something went wrong submitting the request. Try again.");
        }
        return;
      }
      router.push(`/requests/${body.request_id}?submitted=1`);
    } catch {
      setSubmitError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {submitError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Idea / topic <span className="text-red-500">*</span>
        </label>
        <textarea
          value={ideaOrTopic}
          onChange={(e) => setIdeaOrTopic(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-slate-300 text-sm p-2"
          placeholder="Describe the content idea in a sentence or two — not just a link or a keyword."
        />
        {errorFor("idea_or_topic") && (
          <p className="mt-1 text-xs text-red-600">{errorFor("idea_or_topic")}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Target audience <span className="text-red-500">*</span>
        </label>
        <input
          value={targetAudience}
          onChange={(e) => setTargetAudience(e.target.value)}
          className="w-full rounded-md border border-slate-300 text-sm p-2"
          placeholder="e.g. Early-career product managers"
        />
        {errorFor("target_audience") && (
          <p className="mt-1 text-xs text-red-600">{errorFor("target_audience")}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Reference URL <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="w-full rounded-md border border-slate-300 text-sm p-2"
          placeholder="https://..."
        />
        {errorFor("source_url") && (
          <p className="mt-1 text-xs text-red-600">{errorFor("source_url")}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Supporting material <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          type="file"
          accept=".txt,.pdf,.xlsx,.csv,.docx"
          onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">
          .txt, .pdf, .xlsx, .csv, or .docx — up to 20MB. Corrupt files are caught during
          research and flagged, not silently dropped.
        </p>
        {errorFor("attachment") && (
          <p className="mt-1 text-xs text-red-600">{errorFor("attachment")}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Tone</label>
        <select
          value={toneOption}
          onChange={(e) => setToneOption(e.target.value)}
          className="w-full rounded-md border border-slate-300 text-sm p-2"
        >
          <option value="professional">Professional</option>
          <option value="conversational">Conversational</option>
          <option value="authoritative">Authoritative</option>
          <option value="playful">Playful</option>
          <option value={CUSTOM_TONE_OPTION}>Other (type your own)…</option>
        </select>
        {toneOption === CUSTOM_TONE_OPTION && (
          <input
            value={customTone}
            onChange={(e) => setCustomTone(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-300 text-sm p-2"
            placeholder="e.g. Wry and a little skeptical"
            maxLength={40}
          />
        )}
        {errorFor("tone") && <p className="mt-1 text-xs text-red-600">{errorFor("tone")}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Channels <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-4">
          {CHANNELS.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={channels.includes(c.value)}
                onChange={() => toggleChannel(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
        {errorFor("priority_channels") && (
          <p className="mt-1 text-xs text-red-600">{errorFor("priority_channels")}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-slate-700">
            Custom rubric criteria <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          {customCriteria.length < MAX_CUSTOM_CRITERIA && (
            <button
              type="button"
              onClick={addCustomCriterion}
              className="text-xs font-medium text-accent-700 hover:underline"
            >
              + Add criterion
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 mb-2">
          Added on top of the default 9-point rubric, just for this request — a criterion the
          self-evaluation step scores like any other, labeled as custom in review.
        </p>
        {customCriteria.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No custom criteria added.</p>
        ) : (
          <div className="space-y-3">
            {customCriteria.map((criterion, i) => (
              <div key={i} className="rounded-md border border-slate-200 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    value={criterion.name}
                    onChange={(e) => updateCustomCriterion(i, "name", e.target.value)}
                    className="flex-1 rounded-md border border-slate-300 text-sm p-1.5"
                    placeholder="Criterion name, e.g. Hook Strength"
                    maxLength={60}
                  />
                  <button
                    type="button"
                    onClick={() => removeCustomCriterion(i)}
                    className="text-xs text-slate-400 hover:text-red-600"
                    aria-label="Remove criterion"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  value={criterion.description}
                  onChange={(e) => updateCustomCriterion(i, "description", e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 text-sm p-1.5"
                  placeholder="What should this check for? e.g. Does the opening line earn a read within the first two sentences?"
                  maxLength={300}
                />
                {errorFor(`custom_rubric_criteria.${i}.name`) && (
                  <p className="text-xs text-red-600">{errorFor(`custom_rubric_criteria.${i}.name`)}</p>
                )}
                {errorFor(`custom_rubric_criteria.${i}.description`) && (
                  <p className="text-xs text-red-600">{errorFor(`custom_rubric_criteria.${i}.description`)}</p>
                )}
              </div>
            ))}
          </div>
        )}
        {errorFor("custom_rubric_criteria") && (
          <p className="mt-1 text-xs text-red-600">{errorFor("custom_rubric_criteria")}</p>
        )}
      </div>

      {reviewerCandidates.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Reviewers <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <div className="flex flex-wrap gap-3">
            {reviewerCandidates.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={reviewerIds.includes(p.id)}
                  onChange={() => toggleReviewer(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Any assigned reviewer can approve, reject, or request changes — the first decision
            recorded wins.
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="text-sm font-medium bg-accent-600 text-white px-4 py-2 rounded-md hover:bg-accent-700 disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit request"}
      </button>
    </form>
  );
}
