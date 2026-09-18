import type { RequestStatus } from "@/lib/types";
import { isFailureStatus, isTerminalRejection } from "@/lib/board";

const LABELS: Record<RequestStatus, string> = {
  intake_complete: "Queued for research",
  research_failed: "Research failed",
  research_complete: "Research complete",
  drafting: "Drafting",
  pending_human_review: "Awaiting review",
  needs_manual_revision: "Needs revision",
  rejected_by_human: "Rejected",
  approved: "Approved",
  published: "Published",
};

export default function StatusBadge({ status }: { status: RequestStatus }) {
  const isFailure = isFailureStatus(status);
  const isRejected = isTerminalRejection(status);
  const isApproved = status === "approved" || status === "published";

  const classes = isFailure
    ? "bg-red-100 text-red-800"
    : isRejected
    ? "bg-slate-200 text-slate-600"
    : isApproved
    ? "bg-emerald-100 text-emerald-800"
    : "bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${classes}`}>
      {isFailure && <span aria-hidden>⚠️</span>}
      {LABELS[status]}
    </span>
  );
}
