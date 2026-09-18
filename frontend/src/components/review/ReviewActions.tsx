"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReviewDecision } from "@/lib/types";
import { isFutureDateTime } from "@/lib/validation";

export default function ReviewActions({
  requestId,
  draftId,
  existingDecision,
}: {
  requestId: string;
  draftId: string;
  existingDecision: ReviewDecision | null;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<
    "approve" | "reject" | "request_changes" | null
  >(null);
  const [notes, setNotes] = useState("");
  // Publish timing is decided here, at approval — not at intake (moved
  // 2026-09-17: a request's fate isn't known yet when it's submitted, and
  // the PRD's own ordering is "review, THEN publish or schedule").
  const [publishTiming, setPublishTiming] = useState<"immediately" | "scheduled">("immediately");
  const [scheduledFor, setScheduledFor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<{ decided_by: string; decided_action: string } | null>(
    null
  );
  const [staleDraft, setStaleDraft] = useState(false);

  if (existingDecision) {
    return (
      <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
        Already <span className="font-medium">{existingDecision.action.replace("_", " ")}</span> —
        no further action needed here.
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
        Already decided by <span className="font-medium">{conflict.decided_by}</span> (
        {conflict.decided_action.replace("_", " ")}) — no action needed, refreshing the page.
      </div>
    );
  }

  if (staleDraft) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
        This request has moved to a newer version since you opened it — refreshing to show the
        current draft.
      </div>
    );
  }

  async function submit(action: "approve" | "reject" | "request_changes") {
    if (action === "approve" && publishTiming === "scheduled") {
      if (!scheduledFor || !isFutureDateTime(scheduledFor)) {
        setError("Pick a future date and time, or choose 'publish immediately'.");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/webhooks/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          draft_id: draftId,
          action,
          notes: notes.trim() || null,
          ...(action === "approve"
            ? { publish_timing: publishTiming, scheduled_for: publishTiming === "scheduled" ? scheduledFor : null }
            : {}),
        }),
      });
      const body = await res.json();
      if (res.status === 409 && body.reason === "stale_draft") {
        setStaleDraft(true);
        setTimeout(() => router.refresh(), 1500);
        return;
      }
      if (res.status === 409) {
        setConflict({ decided_by: body.decided_by, decided_action: body.decided_action });
        setTimeout(() => router.refresh(), 1500);
        return;
      }
      if (res.status === 400 && body.reason === "invalid_schedule") {
        setError(body.message ?? "Pick a future date and time, or choose 'publish immediately'.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong recording that decision. Try again.");
        return;
      }
      setPendingAction(null);
      setNotes("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          disabled={submitting}
          onClick={() => setPendingAction(pendingAction === "approve" ? null : "approve")}
          className="text-sm font-medium bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={submitting}
          onClick={() => setPendingAction(pendingAction === "request_changes" ? null : "request_changes")}
          className="text-sm font-medium bg-amber-500 text-white px-3 py-1.5 rounded-md hover:bg-amber-600 disabled:opacity-50"
        >
          Request Changes
        </button>
        <button
          disabled={submitting}
          onClick={() => setPendingAction(pendingAction === "reject" ? null : "reject")}
          className="text-sm font-medium bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {pendingAction === "approve" && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Publishing</label>
          <div className="flex gap-4 mb-2">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="radio"
                checked={publishTiming === "immediately"}
                onChange={() => setPublishTiming("immediately")}
              />
              Publish immediately
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="radio"
                checked={publishTiming === "scheduled"}
                onChange={() => setPublishTiming("scheduled")}
              />
              Schedule
            </label>
          </div>
          {publishTiming === "scheduled" && (
            <div className="mb-2">
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="rounded-md border border-slate-300 text-sm p-2"
              />
              <p className="mt-1 text-xs text-slate-400">Past dates and times can&apos;t be selected.</p>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              disabled={submitting}
              onClick={() => submit("approve")}
              className="text-sm font-medium bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "Approving…" : "Confirm Approve"}
            </button>
            <button
              onClick={() => setPendingAction(null)}
              className="text-sm text-slate-500 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(pendingAction === "reject" || pendingAction === "request_changes") && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {pendingAction === "reject"
              ? "Why is this being rejected? (this ends the request — no auto-regeneration)"
              : "What needs to change?"}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 text-sm p-2"
            placeholder="Add a note for the record..."
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={submitting}
              onClick={() => submit(pendingAction)}
              className="text-sm font-medium bg-slate-800 text-white px-3 py-1.5 rounded-md hover:bg-slate-900 disabled:opacity-50"
            >
              {submitting
                ? pendingAction === "reject"
                  ? "Rejecting…"
                  : "Requesting changes…"
                : `Confirm ${pendingAction === "reject" ? "Reject" : "Request Changes"}`}
            </button>
            <button
              onClick={() => setPendingAction(null)}
              className="text-sm text-slate-500 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
