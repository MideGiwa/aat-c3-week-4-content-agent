"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Used on both /requests/[id] (research_failed banner) and RequestCard (on
// the board, wrapped in a <Link> to the request — stopPropagation +
// preventDefault there keep a click on the button from also navigating).
// Re-runs the pipeline for a request stuck at `research_failed`
// (/api/webhooks/retry-request); see supabase/webhooks.ts's
// handleRetryRequestWebhook for what "retry" actually does (clears the
// failed attempt's partial rows, then runs the initial pipeline again from
// scratch).
export default function RetryRequestButton({
  requestId,
  compact = false,
}: {
  requestId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/webhooks/retry-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.reason === "not_failed"
            ? "This request isn't in a failed state anymore — refreshing."
            : "Couldn't retry — try again in a moment."
        );
        setTimeout(() => router.refresh(), 1500);
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={compact ? "mt-2" : "shrink-0"}>
      <button
        type="button"
        disabled={submitting}
        onClick={retry}
        className={
          compact
            ? "text-xs font-medium text-red-700 border border-red-300 px-2 py-1 rounded-md hover:bg-red-100 disabled:opacity-50"
            : "text-sm font-medium bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
        }
      >
        {submitting ? "Retrying…" : "Retry"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
