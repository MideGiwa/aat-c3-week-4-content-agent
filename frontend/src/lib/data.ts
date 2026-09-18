import { USE_MOCK_DATA } from "./config";
import { getStore } from "./mock/store";
import { getSupabaseServerClient } from "./supabase/server";
import { getSupabaseRouteClient } from "./supabase/routeClient";
import type {
  ActivityLogEntry,
  ChannelAsset,
  ContentRequest,
  Draft,
  Evaluation,
  Profile,
  RequestDetail,
  ReviewDecision,
  SourceRef,
} from "./types";

// The data-access layer. Every read the app needs goes through here so
// that swapping mock data for real Supabase (FRONTEND-SPEC.md
// "Architecture") means rewriting the *inside* of these functions, not
// every place that calls them.
//
// Real mode splits reads across two different clients, on purpose:
// listRequests()/getRequestDetail() go through routeClient.ts's
// session-aware client, so supabase/schema.sql's RLS policies actually
// filter what a given logged-in reviewer/submitter/admin can see — that's
// the whole point of wiring up Auth (see DESIGN.md's decisions-log entry).
// getProfile()/listProfiles() stay on the service-role client
// (supabase/server.ts) because profiles has no RLS at all, by design (the
// reviewer picker needs to see everyone) — using either client there
// behaves identically, so there's no reason to require a session for it.
// Every table/column name below is exactly what supabase/schema.sql
// creates.

function requestRowToContentRequest(row: RequestRow): ContentRequest {
  return {
    id: row.id,
    idea_or_topic: row.idea_or_topic,
    target_audience: row.target_audience,
    source_url: row.source_url,
    tone: row.tone,
    priority_channels: (row.priority_channels ?? []) as ContentRequest["priority_channels"],
    publish_timing: row.publish_timing,
    scheduled_for: row.scheduled_for,
    title_options: (row.title_options as [string, string] | null) ?? null,
    chosen_title_index: row.chosen_title_index,
    title_option_reason: row.title_option_reason,
    chosen_draft_id: row.chosen_draft_id ?? null,
    custom_rubric_criteria: row.custom_rubric_criteria ?? [],
    status: row.status,
    failure_reason: row.failure_reason,
    submitted_by: row.submitted_by,
    reviewer_ids: row.reviewer_ids ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// The shape a `requests` row + its joined reviewer ids comes back as.
interface RequestRow {
  id: string;
  idea_or_topic: string;
  target_audience: string;
  source_url: string | null;
  tone: string;
  priority_channels: string[] | null;
  publish_timing: ContentRequest["publish_timing"];
  scheduled_for: string | null;
  title_options: string[] | null;
  chosen_title_index: 0 | 1 | null;
  title_option_reason: string | null;
  chosen_draft_id: string | null;
  custom_rubric_criteria: ContentRequest["custom_rubric_criteria"] | null;
  status: ContentRequest["status"];
  failure_reason: string | null;
  submitted_by: string;
  reviewer_ids?: string[];
  created_at: string;
  updated_at: string;
}

export async function getProfile(id: string): Promise<Profile | null> {
  if (USE_MOCK_DATA) {
    return getStore().profiles.find((p) => p.id === id) ?? null;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function listRequests(): Promise<ContentRequest[]> {
  if (USE_MOCK_DATA) {
    return [...getStore().requests].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  const supabase = getSupabaseRouteClient();
  const { data: requests, error } = await supabase
    .from("requests")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  if (!requests || requests.length === 0) return [];

  const { data: reviewerRows, error: reviewerError } = await supabase
    .from("request_reviewers")
    .select("request_id, reviewer_id")
    .in(
      "request_id",
      requests.map((r) => r.id)
    );
  if (reviewerError) throw reviewerError;

  const reviewersByRequest = new Map<string, string[]>();
  for (const row of reviewerRows ?? []) {
    const list = reviewersByRequest.get(row.request_id) ?? [];
    list.push(row.reviewer_id);
    reviewersByRequest.set(row.request_id, list);
  }

  return requests.map((row) =>
    requestRowToContentRequest({ ...row, reviewer_ids: reviewersByRequest.get(row.id) ?? [] })
  );
}

export async function getRequestDetail(requestId: string): Promise<RequestDetail | null> {
  if (USE_MOCK_DATA) {
    const store = getStore();
    const request = store.requests.find((r) => r.id === requestId);
    if (!request) return null;

    const submitter = store.profiles.find((p) => p.id === request.submitted_by);
    if (!submitter) return null;

    const reviewers = store.profiles.filter((p) => request.reviewer_ids.includes(p.id));
    const sources = store.sources.filter((s) => s.request_id === requestId);
    const drafts = store.drafts
      .filter((d) => d.request_id === requestId)
      .sort((a, b) => a.version - b.version);
    const draftIds = new Set(drafts.map((d) => d.id));
    const evaluations = store.evaluations
      .filter((e) => draftIds.has(e.draft_id))
      .sort((a, b) => a.round - b.round);
    const channelAssets = store.channelAssets.filter((c) => c.request_id === requestId);
    // Newest first (2026-09-18 — reviewers want to see what just happened
    // at the top, not scroll to the bottom of a growing list).
    const activity = store.activity
      .filter((a) => a.request_id === requestId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // The decision (if any) is looked up against the ACTIVE draft
    // (request.chosen_draft_id), not just the highest version — switching
    // back to an earlier-generated angle can make an older version active
    // again (see ContentRequest.chosen_draft_id's doc comment).
    const activeDraft = drafts.find((d) => d.id === request.chosen_draft_id) ?? drafts[drafts.length - 1];
    const decision = activeDraft
      ? store.decisions.find((d) => d.draft_id === activeDraft.id) ?? null
      : null;

    return {
      request,
      submitter,
      reviewers,
      sources,
      drafts,
      evaluations,
      channelAssets,
      activity,
      decision,
    };
  }

  const supabase = getSupabaseRouteClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!requestRow) {
    // Genuinely no row (bad id) or RLS's requests_select policy filtered it
    // out (viewer is neither the submitter, an assigned reviewer, nor an
    // admin) — either way, 404 is the right response. Logged because the
    // two cases are indistinguishable from the UI and worth telling apart
    // when a user reports "my own request 404s".
    console.warn(`[getRequestDetail] no requests row visible for id=${requestId} (not found, or RLS denied)`);
    return null;
  }

  const { data: reviewerRows, error: reviewerError } = await supabase
    .from("request_reviewers")
    .select("reviewer_id")
    .eq("request_id", requestId);
  if (reviewerError) throw reviewerError;
  const reviewerIds = (reviewerRows ?? []).map((r) => r.reviewer_id);

  const request = requestRowToContentRequest({ ...requestRow, reviewer_ids: reviewerIds });

  const [
    { data: submitterRow, error: submitterError },
    { data: reviewerProfiles, error: reviewerProfilesError },
    { data: sourceRows, error: sourceError },
    { data: draftRows, error: draftError },
    { data: channelAssetRows, error: channelAssetError },
    { data: activityRows, error: activityError },
  ] = await Promise.all([
    request.submitted_by
      ? supabase.from("profiles").select("*").eq("id", request.submitted_by).maybeSingle()
      : Promise.resolve({ data: null as Profile | null, error: null }),
    reviewerIds.length > 0
      ? supabase.from("profiles").select("*").in("id", reviewerIds)
      : Promise.resolve({ data: [] as Profile[], error: null }),
    supabase.from("sources").select("*").eq("request_id", requestId),
    supabase.from("drafts").select("*").eq("request_id", requestId).order("version", { ascending: true }),
    supabase.from("channel_assets").select("*").eq("request_id", requestId),
    supabase
      .from("activity_log")
      .select("*")
      .eq("request_id", requestId)
      // Newest first (2026-09-18) — see the mock branch's matching comment.
      .order("created_at", { ascending: false }),
  ]);
  if (submitterError) throw submitterError;
  if (reviewerProfilesError) throw reviewerProfilesError;
  if (sourceError) throw sourceError;
  if (draftError) throw draftError;
  if (channelAssetError) throw channelAssetError;
  if (activityError) throw activityError;

  // A missing submitter profile used to 404 the *entire* request page —
  // but the request itself was already confirmed to exist and be visible
  // to this viewer above. profiles has no RLS (schema.sql), so a missing
  // row here means an actual data-integrity gap (e.g. a request whose
  // submitted_by predates that profile being created, or a profile that
  // was later removed), not an authorization result. Hiding the whole
  // page behind a 404 for that turned an "unknown submitter" cosmetic
  // issue into "I can't see my own request." Render with a clearly-marked
  // placeholder instead, and log loudly so the real data gap gets noticed
  // and fixed at the source.
  if (!submitterRow) {
    console.error(
      `[getRequestDetail] request ${requestId} has submitted_by=${request.submitted_by} but no matching profiles row exists — rendering with a placeholder submitter instead of 404ing.`
    );
  }
  const submitter: Profile = (submitterRow as Profile | null) ?? {
    id: request.submitted_by,
    name: "Unknown user",
    email: "",
    roles: [],
  };

  const drafts = (draftRows ?? []) as Draft[];
  const draftIds = drafts.map((d) => d.id);

  const [{ data: evaluationRows, error: evaluationError }, { data: decisionRows, error: decisionError }] =
    await Promise.all([
      draftIds.length > 0
        ? supabase.from("evaluations").select("*").in("draft_id", draftIds).order("round", { ascending: true })
        : Promise.resolve({ data: [] as Evaluation[], error: null }),
      draftIds.length > 0
        ? supabase.from("review_decisions").select("*").in("draft_id", draftIds)
        : Promise.resolve({ data: [] as ReviewDecision[], error: null }),
    ]);
  if (evaluationError) throw evaluationError;
  if (decisionError) throw decisionError;

  // Decision is looked up against the ACTIVE draft, same as the mock
  // branch — see that branch's comment and ContentRequest.chosen_draft_id.
  const activeDraft = drafts.find((d) => d.id === request.chosen_draft_id) ?? drafts[drafts.length - 1];
  const decision =
    (activeDraft && (decisionRows ?? []).find((d) => d.draft_id === activeDraft.id)) || null;

  return {
    request,
    submitter,
    reviewers: (reviewerProfiles ?? []) as Profile[],
    sources: (sourceRows ?? []) as SourceRef[],
    drafts,
    evaluations: (evaluationRows ?? []) as Evaluation[],
    channelAssets: (channelAssetRows ?? []) as ChannelAsset[],
    activity: (activityRows ?? []) as ActivityLogEntry[],
    decision: decision as ReviewDecision | null,
  };
}

export async function listProfiles(): Promise<Profile[]> {
  if (USE_MOCK_DATA) {
    return getStore().profiles;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Profile[];
}
