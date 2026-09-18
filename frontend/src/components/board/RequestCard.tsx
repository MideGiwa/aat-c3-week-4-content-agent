import Link from "next/link";
import type { ContentRequest } from "@/lib/types";
import StatusBadge from "../StatusBadge";
import { isFailureStatus } from "@/lib/board";
import RetryRequestButton from "../review/RetryRequestButton";

const CHANNEL_ICON: Record<string, string> = {
  linkedin: "in",
  x: "𝕏",
  newsletter: "✉",
};

// failure_reason isn't always a short code like "no_search_results" — a
// pipeline error's generic catch-all (failResearch's "Pipeline failed
// unexpectedly: ${err}") can carry a full raw error string, sometimes with
// an embedded JSON payload (e.g. a 429 from a provider's API dumping its
// entire billing-page response). That's genuinely useful detail on the
// request's own page, where there's room and a Retry button next to it,
// but it doesn't belong dumped in full onto a compact Kanban card — it
// blows out the card's height and drowns out everything else in the
// column. Hard-capped here (with the full text still in `title`, so
// hovering shows it) rather than relying on line-clamp alone, since a
// single long unbroken token (a URL, a run-on JSON blob) can defeat
// line-clamp's line-based wrapping.
const CARD_FAILURE_REASON_MAX_CHARS = 100;

function summarizeFailureReason(reason: string): string {
  const cleaned = reason.replace(/_/g, " ").trim();
  return cleaned.length > CARD_FAILURE_REASON_MAX_CHARS
    ? `${cleaned.slice(0, CARD_FAILURE_REASON_MAX_CHARS).trimEnd()}…`
    : cleaned;
}

export default function RequestCard({ request }: { request: ContentRequest }) {
  const needsAttention = isFailureStatus(request.status);

  return (
    <Link
      href={`/requests/${request.id}`}
      className={`block rounded-lg border bg-white p-3 shadow-sm hover:shadow-md transition-shadow ${
        needsAttention ? "border-red-300" : "border-slate-200"
      }`}
    >
      <p className="text-sm font-medium text-slate-900 line-clamp-2">{request.idea_or_topic}</p>
      <p className="mt-1 text-xs text-slate-500 line-clamp-1">{request.target_audience}</p>

      <div className="mt-2 flex items-center justify-between">
        <StatusBadge status={request.status} />
        <div className="flex items-center gap-1 text-slate-400" aria-label="Priority channels">
          {request.priority_channels.map((c) => (
            <span key={c} className="text-xs" title={c}>
              {CHANNEL_ICON[c] ?? c}
            </span>
          ))}
        </div>
      </div>

      {request.publish_timing === "scheduled" && request.scheduled_for && (
        <p className="mt-2 text-xs text-slate-400">
          Scheduled {new Date(request.scheduled_for).toLocaleString()}
        </p>
      )}

      {needsAttention && request.failure_reason && (
        <p className="mt-2 text-xs text-red-600 line-clamp-2" title={request.failure_reason}>
          {summarizeFailureReason(request.failure_reason)}
        </p>
      )}

      {request.status === "research_failed" && <RetryRequestButton requestId={request.id} compact />}
    </Link>
  );
}
