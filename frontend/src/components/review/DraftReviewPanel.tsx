"use client";

// Client wrapper tying VersionHistory's interactive version-switcher to
// DraftViewer/EvaluationPanel below it, and deciding which draft
// ReviewActions applies to. Review actions always apply to the ACTIVE draft
// (request.chosen_draft_id) — never whichever one happens to be selected
// for viewing, and, since the 2026-09-18 angle-switching fix, not
// necessarily the highest version number either (switching back to a
// previously-generated angle can make an older version active again — see
// ContentRequest.chosen_draft_id's doc comment). Non-active versions are
// read-only in DraftViewer.

import { useState } from "react";
import type { Draft, Evaluation, ReviewDecision, SourceRef } from "@/lib/types";
import VersionHistory from "./VersionHistory";
import DraftViewer from "./DraftViewer";
import EvaluationPanel from "./EvaluationPanel";
import ReviewActions from "./ReviewActions";

export default function DraftReviewPanel({
  requestId,
  drafts,
  evaluations,
  sources,
  chosenDraftId,
  latestDecision,
}: {
  requestId: string;
  drafts: Draft[];
  evaluations: Evaluation[];
  sources: SourceRef[];
  chosenDraftId: string | null;
  latestDecision: ReviewDecision | null;
}) {
  const latestDraft = drafts[drafts.length - 1];
  const activeDraft = drafts.find((d) => d.id === chosenDraftId) ?? latestDraft;
  const [selectedDraftId, setSelectedDraftId] = useState(activeDraft?.id ?? "");

  if (!activeDraft) {
    return (
      <div className="text-sm text-slate-400">
        No draft has been generated for this request yet.
      </div>
    );
  }

  const selectedDraft = drafts.find((d) => d.id === selectedDraftId) ?? activeDraft;
  const selectedEvaluation = evaluations
    .filter((e) => e.draft_id === selectedDraftId)
    .at(-1);
  const isActive = selectedDraft.id === activeDraft.id;

  return (
    <div className="space-y-4">
      {drafts.length > 1 && (
        <VersionHistory
          drafts={drafts}
          evaluations={evaluations}
          selectedDraftId={selectedDraftId}
          activeDraftId={activeDraft.id}
          onSelect={setSelectedDraftId}
        />
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <DraftViewer
          draft={selectedDraft}
          sources={sources}
          editable={isActive && !latestDecision}
          requestId={requestId}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <EvaluationPanel evaluation={selectedEvaluation} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Review decision</h3>
        {isActive ? (
          <ReviewActions
            requestId={requestId}
            draftId={activeDraft.id}
            existingDecision={latestDecision}
          />
        ) : (
          <p className="text-xs text-slate-400">
            Viewing v{selectedDraft.version} — review actions apply to the active version
            (v{activeDraft.version}) only. Switch to it above to decide.
          </p>
        )}
      </div>
    </div>
  );
}
