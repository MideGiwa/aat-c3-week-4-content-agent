"use client";

// Closes the PRD compliance gap found 2026-09-17: "a human can approve,
// reject, revise, or select content before publishing" — Planning
// generates two title/angle options but used to pick between them with its
// own heuristic before a human ever saw a draft. This lets a reviewer see
// both options and switch to the other one.
//
// 2026-09-18 UI revision: switching to an angle that's already been
// drafted no longer regenerates anything — the server just repoints
// chosen_draft_id at the existing draft (src/lib/pipeline/run.ts's
// runSelectOptionPipeline / supabase/webhooks.ts's counterpart). Only an
// angle that's never been drafted for this request triggers a real
// generation (and the AI call/cost that comes with it) — optionsHaveDrafts
// tells this component which case it is so the button and copy don't imply
// "regenerating" when they're really just "switching."

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "../ui/Button";

export default function ContentAngleSelector({
  requestId,
  draftId,
  options,
  chosenIndex,
  reason,
  optionsHaveDrafts,
  locked,
}: {
  requestId: string;
  draftId: string;
  options: [string, string];
  chosenIndex: 0 | 1;
  reason: string;
  /** Whether option A / option B already has at least one generated draft
   * under this request — determines whether "Use this" switches instantly
   * (no AI call) or generates a fresh draft. */
  optionsHaveDrafts: [boolean, boolean];
  /** True once a decision (approve/reject/request-changes) has been
   * recorded — the angle is locked in at that point, same as every other
   * review action. */
  locked: boolean;
}) {
  const router = useRouter();
  const [submittingIndex, setSubmittingIndex] = useState<0 | 1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectOption(index: 0 | 1) {
    if (index === chosenIndex || locked || submittingIndex !== null) return;
    setSubmittingIndex(index);
    setError(null);
    try {
      const res = await fetch("/api/webhooks/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          draft_id: draftId,
          action: "select_option",
          selected_option_label: index === 0 ? "A" : "B",
        }),
      });
      if (!res.ok) {
        setError("Couldn't switch angles. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmittingIndex(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Content angle</h3>
      <p className="text-xs text-slate-400 mb-3">{reason}</p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <div className="space-y-2">
        {options.map((title, idx) => {
          const isChosen = idx === chosenIndex;
          const label = idx === 0 ? "A" : "B";
          const hasDraft = optionsHaveDrafts[idx];
          const isSubmittingThis = submittingIndex === idx;
          return (
            <div
              key={idx}
              className={`flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm ${
                isChosen ? "border-accent-300 bg-accent-50" : "border-slate-200"
              }`}
            >
              <div>
                <span className="text-xs font-mono text-slate-400 mr-2">{label}</span>
                <span className={isChosen ? "font-medium text-accent-800" : "text-slate-600"}>
                  {title}
                </span>
                {isChosen ? (
                  <span className="ml-2 text-xs text-accent-600">(current draft)</span>
                ) : (
                  <span className="ml-2 text-xs text-slate-400">
                    {hasDraft ? "already generated" : "not yet generated"}
                  </span>
                )}
              </div>
              {!isChosen && !locked && (
                <Button
                  variant="accentOutline"
                  size="sm"
                  className="shrink-0"
                  disabled={submittingIndex !== null}
                  loading={isSubmittingThis}
                  onClick={() => selectOption(idx as 0 | 1)}
                >
                  {isSubmittingThis
                    ? hasDraft
                      ? "Switching…"
                      : "Generating…"
                    : hasDraft
                      ? "Switch to this"
                      : "Generate this instead"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {locked && (
        <p className="mt-2 text-xs text-slate-400">
          A decision has been recorded for this request — the angle is locked.
        </p>
      )}
    </div>
  );
}
