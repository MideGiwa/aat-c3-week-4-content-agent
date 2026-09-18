import type { BoardColumn, RequestStatus } from "./types";

export const BOARD_COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: "researching", label: "Researching" },
  { key: "drafting", label: "Drafting" },
  { key: "in_review", label: "In Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

/** Several pipeline statuses collapse into one Kanban column — the board
 * is a queue overview, not a 1:1 status display. A failed/needs-attention
 * item still shows in its natural column with a warning badge (see
 * RequestCard) rather than being hidden or given its own column — per the
 * "gate, don't guess" principle, failures stay visible, not tucked away. */
export function boardColumnForStatus(status: RequestStatus): BoardColumn {
  switch (status) {
    case "intake_complete":
    case "research_failed":
    case "research_complete":
      return "researching";
    case "drafting":
      return "drafting";
    case "pending_human_review":
    case "needs_manual_revision":
      return "in_review";
    case "rejected_by_human":
    case "approved":
      return "approved";
    case "published":
      return "published";
    default:
      return "researching";
  }
}

export function isFailureStatus(status: RequestStatus): boolean {
  return status === "research_failed" || status === "needs_manual_revision";
}

export function isTerminalRejection(status: RequestStatus): boolean {
  return status === "rejected_by_human";
}
