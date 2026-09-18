"use client";

import { useState } from "react";
import type { Draft, Evaluation } from "@/lib/types";

const GENERATED_BY_LABEL: Record<Draft["generated_by"], string> = {
  system_initial: "First draft",
  system_revision: "Auto-revised",
  human_requested: "Revised on request",
  human_edited: "Manually edited",
};

export default function VersionHistory({
  drafts,
  evaluations,
  selectedDraftId,
  activeDraftId,
  onSelect,
}: {
  drafts: Draft[];
  evaluations: Evaluation[];
  selectedDraftId: string;
  /** The draft actually driving review right now (request.chosen_draft_id)
   * — may not be the highest version once a reviewer has switched back to
   * an earlier-generated angle, so it's flagged separately from whichever
   * version is merely selected for viewing below. */
  activeDraftId: string;
  onSelect: (draftId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {drafts.map((draft) => {
        const evaluation = evaluations.filter((e) => e.draft_id === draft.id).at(-1);
        const viewing = draft.id === selectedDraftId;
        const isActive = draft.id === activeDraftId;
        return (
          <button
            key={draft.id}
            onClick={() => onSelect(draft.id)}
            className={`text-xs px-2.5 py-1.5 rounded-md border ${
              viewing
                ? "border-accent-500 bg-accent-50 text-accent-700 font-medium"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            v{draft.version} · {GENERATED_BY_LABEL[draft.generated_by]}
            {isActive && <span className="ml-1.5 text-emerald-600">· current</span>}
            {evaluation && (
              <span
                className={`ml-1.5 ${
                  evaluation.status === "pass"
                    ? "text-emerald-600"
                    : evaluation.status === "revise"
                    ? "text-amber-600"
                    : "text-red-600"
                }`}
              >
                · {evaluation.status}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
