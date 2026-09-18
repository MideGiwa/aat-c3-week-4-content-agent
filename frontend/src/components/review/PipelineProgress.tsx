"use client";

// Shown on the request detail page while the automated pipeline
// (research → planning → drafting → channel prep) is still running in the
// background. Real mode no longer blocks the submit request on this work
// (src/lib/supabase/webhooks.ts's waitUntil), so this is what actually
// tells the submitter something's happening instead of the page just
// looking incomplete. Polls by re-running the page's Server Component
// (router.refresh()) rather than a separate status endpoint — simplest
// way to pick up the same data every other render already reads.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RequestStatus } from "@/lib/types";

// `needs_manual_revision` joined this set 2026-09-18: the automatic
// revision that follows a "Request Changes" decision now runs in the
// background (waitUntil, same as everything else here) instead of blocking
// the review-action response, so this is what tells the reviewer their
// request is being acted on instead of the page just sitting there
// unchanged until a manual reload.
const IN_PROGRESS_STATUSES = new Set<RequestStatus>([
  "intake_complete",
  "research_complete",
  "drafting",
  "needs_manual_revision",
]);

const STEP_LABEL: Partial<Record<RequestStatus, string>> = {
  intake_complete: "Queued — starting research shortly.",
  research_complete: "Research complete — planning and drafting next.",
  drafting: "Drafting and self-reviewing the content.",
  needs_manual_revision: "Applying the requested changes…",
};

const POLL_INTERVAL_MS = 4000;

export default function PipelineProgress({
  status,
  stalled = false,
}: {
  status: RequestStatus;
  /** True once the background work has actually failed (e.g. an automatic
   * revision's `failure_reason` got set) — polling forever wouldn't ever
   * resolve on its own at that point, and a separate failure banner takes
   * over the messaging, so this component should get out of the way rather
   * than keep claiming "this page updates on its own." */
  stalled?: boolean;
}) {
  const router = useRouter();
  const inProgress = IN_PROGRESS_STATUSES.has(status) && !stalled;

  useEffect(() => {
    if (!inProgress) return;
    const interval = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [inProgress, router]);

  if (!inProgress) return null;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm text-accent-800">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent-600 animate-pulse" aria-hidden />
      <span>
        {STEP_LABEL[status] ?? "Working…"} This page updates on its own — no need to refresh.
      </span>
    </div>
  );
}
