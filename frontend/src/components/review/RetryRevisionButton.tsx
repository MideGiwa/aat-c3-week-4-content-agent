"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Shown in the "needs_manual_revision" banner on /requests/[id] once the
// background revision has actually failed (request.failure_reason set) —
// see supabase/webhooks.ts's handleRetryRevisionWebhook for why this can't
// just be "click Request Changes again": a decision is already permanently
// recorded against the stuck draft, so ReviewActions is locked for it.
// Re-runs the same revision (same draft, same original notes) via
// /api/webhooks/retry-revision.
export default function RetryRevisionButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/webhooks/retry-revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.reason === "not_stalled"
            ? "This request isn't stuck anymore — refreshing."
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
    <div className="mt-1.5">
      <button
        type="button"
        disabled={submitting}
        onClick={retry}
        className="text-xs font-medium text-red-700 border border-red-300 px-2 py-1 rounded-md hover:bg-red-100 disabled:opacity-50"
      >
        {submitting ? "Retrying…" : "Retry the revision"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
