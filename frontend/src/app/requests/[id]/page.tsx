import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestDetail } from "@/lib/data";
import StatusBadge from "@/components/StatusBadge";
import PipelineProgress from "@/components/review/PipelineProgress";
import RetryRequestButton from "@/components/review/RetryRequestButton";
import RetryRevisionButton from "@/components/review/RetryRevisionButton";
import DraftReviewPanel from "@/components/review/DraftReviewPanel";
import ContentAngleSelector from "@/components/review/ContentAngleSelector";
import ChannelAssetsPanel from "@/components/review/ChannelAssetsPanel";
import RequestTabs from "@/components/review/RequestTabs";
import SourceList from "@/components/review/SourceList";
import ActivityTrail from "@/components/review/ActivityTrail";

export const dynamic = "force-dynamic"; // always read the latest mock/live state

const CHANNEL_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  newsletter: "Newsletter",
};

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { submitted?: string };
}) {
  const detail = await getRequestDetail(params.id);
  if (!detail) notFound();

  const { request, submitter, reviewers, sources, drafts, evaluations, channelAssets, activity, decision } =
    detail;

  const activeDraft = drafts.find((d) => d.id === request.chosen_draft_id) ?? drafts[drafts.length - 1];
  // Which of the two planning options already has a generated draft under
  // this request — lets ContentAngleSelector show "switch" vs "generate"
  // instead of implying every switch regenerates (2026-09-18 UI revision).
  const optionsHaveDrafts: [boolean, boolean] = [
    drafts.some((d) => d.option_label === "A"),
    drafts.some((d) => d.option_label === "B"),
  ];
  // Channel copy shown is always the ACTIVE draft's — assets are keyed by
  // draft_id and never deleted, so a request can accumulate copy from
  // several draft versions over time (2026-09-18 fix).
  const activeChannelAssets = activeDraft
    ? channelAssets.filter((c) => c.draft_id === activeDraft.id)
    : [];
  // The most recent "request changes" note — activity is newest-first, so
  // this is whichever request_changes decision put the request into its
  // current needs_manual_revision state (2026-09-18: surfaces the "why"
  // that used to be buried in the activity trail only).
  const latestRequestChangesEntry =
    request.status === "needs_manual_revision"
      ? activity.find((a) => a.action === "request_changes")
      : undefined;
  // The automatic revision runs in the background (waitUntil) — stalled
  // means it's no longer plausibly still running, so PipelineProgress
  // should stop polling and this banner should show the failure instead of
  // "applying changes…" (2026-09-18 fix). That's not only a caught failure
  // (failure_reason set): a background job can also die silently with
  // failure_reason still null if the process running it was killed
  // mid-flight (a local `next dev` restart is the easy way to hit this) —
  // so anything sitting here longer than the route could possibly still be
  // running (REVISION_STALE_MS, matching maxDuration=300) counts as stalled
  // too, matching the same staleness guard on the retry-revision webhook
  // itself (2026-09-18, second fix same day).
  const REVISION_STALE_MS = 5 * 60 * 1000;
  const revisionStalled =
    request.status === "needs_manual_revision" &&
    (!!request.failure_reason || Date.now() - new Date(request.updated_at).getTime() > REVISION_STALE_MS);

  return (
    <div>
      <Link href="/board" className="text-xs text-accent-700 hover:underline">
        ← Back to board
      </Link>

      <div className="mt-2 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{request.idea_or_topic}</h1>
          <p className="text-sm text-slate-500 mt-1">{request.target_audience}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {searchParams.submitted === "1" && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          ✅ Request submitted. Research and drafting run in the background — feel free to close this
          page or head back to the board; you can check back here anytime to see progress.
        </div>
      )}

      <PipelineProgress status={request.status} stalled={revisionStalled} />

      {request.status === "research_failed" && request.failure_reason && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="break-words">Research failed: {request.failure_reason.replace(/_/g, " ")}.</span>
          <RetryRequestButton requestId={request.id} />
        </div>
      )}

      {request.status === "needs_manual_revision" && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <p className="break-words">
            <span className="font-medium">Changes requested</span>
            {latestRequestChangesEntry?.actor_name ? ` by ${latestRequestChangesEntry.actor_name}` : ""}
            {latestRequestChangesEntry?.notes ? `: "${latestRequestChangesEntry.notes}"` : " — no notes given."}
          </p>
          {revisionStalled && (
            <>
              <p className="mt-1.5 break-words text-red-700">
                ⚠ {request.failure_reason ?? "This is taking longer than expected — it may have stalled."}
              </p>
              <RetryRevisionButton requestId={request.id} />
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RequestTabs
            draftTab={
              <>
                {request.title_options && activeDraft && (
                  <ContentAngleSelector
                    requestId={request.id}
                    draftId={activeDraft.id}
                    options={request.title_options}
                    chosenIndex={request.chosen_title_index ?? 0}
                    reason={request.title_option_reason ?? ""}
                    optionsHaveDrafts={optionsHaveDrafts}
                    locked={!!decision}
                  />
                )}

                <DraftReviewPanel
                  requestId={request.id}
                  drafts={drafts}
                  evaluations={evaluations}
                  sources={sources}
                  chosenDraftId={request.chosen_draft_id}
                  latestDecision={decision}
                />
              </>
            }
            channelCopyTab={
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Channel copy</h3>
                <ChannelAssetsPanel assets={activeChannelAssets} />
              </div>
            }
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Request details</h3>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-400">Submitted by</dt>
                <dd className="text-slate-700">{submitter.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Reviewers</dt>
                <dd className="text-slate-700 text-right">
                  {reviewers.length > 0
                    ? reviewers.map((r) => r.name).join(", ")
                    : "None assigned"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Tone</dt>
                <dd className="text-slate-700">{request.tone}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Channels</dt>
                <dd className="text-slate-700 text-right">
                  {request.priority_channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Publish timing</dt>
                <dd className="text-slate-700 text-right">
                  {request.publish_timing === "scheduled" && request.scheduled_for
                    ? new Date(request.scheduled_for).toLocaleString()
                    : request.publish_timing === "immediately"
                      ? "Immediately"
                      : "Not yet decided — set on approval"}
                </dd>
              </div>
              {request.source_url && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400 shrink-0">Reference URL</dt>
                  <dd className="text-accent-700 text-right truncate">
                    <a href={request.source_url} target="_blank" rel="noreferrer" className="hover:underline">
                      {request.source_url}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {request.custom_rubric_criteria.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-1.5">
                  Custom rubric criteria <span className="text-accent-600">★</span>
                </p>
                <ul className="space-y-1.5">
                  {request.custom_rubric_criteria.map((c) => (
                    <li key={c.name} className="text-xs">
                      <span className="font-medium text-slate-700">{c.name}</span>
                      <p className="text-slate-500">{c.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            {/* citingSections reflects the ACTIVE draft only, not whichever
                version a reviewer happens to be viewing in DraftReviewPanel's
                version history (that's client-side state this server
                component can't see) — the active draft is the one that
                actually matters for what will get published. */}
            <SourceList sources={sources} citingSections={activeDraft?.sections ?? []} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <ActivityTrail entries={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}
