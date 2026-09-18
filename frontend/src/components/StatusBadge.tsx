import type { RequestStatus } from "@/lib/types";
import { isFailureStatus, isTerminalRejection } from "@/lib/board";
import Badge from "./ui/Badge";

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

  const tone = isFailure ? "danger" : isRejected ? "neutral" : isApproved ? "success" : "neutral";

  return (
    <Badge tone={tone}>
      {isFailure && <span aria-hidden>⚠️</span>}
      {LABELS[status]}
    </Badge>
  );
}
