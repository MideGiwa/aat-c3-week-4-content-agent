// Shared types mirroring DESIGN.md §6 (Data Model). Kept close to the
// Supabase schema on purpose — when this app moves off mock data, these
// types should need little to no change, only the data-access layer
// (src/lib/data.ts) does.

export type Channel = "linkedin" | "x" | "newsletter";

/** A request-specific rubric criterion added at intake, on top of the
 * default 9 (assets/content-evaluation-rubric.md) — additive, never a
 * replacement, per DESIGN.md §13. Scored alongside the defaults at
 * evaluation time and tagged `scope: "custom"` in RubricScore so it's
 * obvious in review which criteria are PRD-standard and which were added
 * for this request. */
export interface CustomRubricCriterion {
  name: string;
  description: string;
}

export type RequestStatus =
  | "intake_complete"
  | "research_failed"
  | "research_complete"
  | "drafting"
  | "pending_human_review"
  | "needs_manual_revision"
  | "rejected_by_human"
  | "approved"
  | "published";

/** The five Kanban columns. Several RequestStatus values collapse into one
 * column; see boardColumnForStatus() in src/lib/board.ts. */
export type BoardColumn =
  | "researching"
  | "drafting"
  | "in_review"
  | "approved"
  | "published";

export type FileType = "txt" | "pdf" | "spreadsheet" | "docx";
export type AttachmentStatus = "uploaded" | "processing" | "corrupt" | "removed";

export interface Profile {
  id: string;
  name: string;
  email: string;
  roles: Array<"content_manager" | "reviewer" | "admin">;
}

export interface RequestAttachment {
  id: string;
  request_id: string;
  file_type: FileType;
  file_name: string;
  status: AttachmentStatus;
  uploaded_at: string;
  removed_at: string | null;
}

export interface ContentRequest {
  id: string;
  idea_or_topic: string;
  target_audience: string;
  source_url: string | null;
  tone: string;
  priority_channels: Channel[];
  // null until a reviewer approves — publish timing is decided at approval,
  // not at intake (DESIGN.md decisions log, 2026-09-17), so there's nothing
  // real to store here before that happens. Only handleReviewActionWebhook's
  // "approve" branch ever sets this to a non-null value.
  publish_timing: "immediately" | "scheduled" | null;
  scheduled_for: string | null;
  /** The two title/angle options Planning generated, and which one is the
   * active draft's — set once the pipeline runs, null for anything created
   * before this existed. Lets a reviewer switch to the other angle (PRD:
   * "...or select content") instead of that choice being locked in by the
   * pipeline's own heuristic before a human ever sees it. */
  title_options: [string, string] | null;
  chosen_title_index: 0 | 1 | null;
  title_option_reason: string | null;
  /** The draft actually driving review right now — decoupled from "highest
   * version number" (2026-09-18 fix). Switching back to a previously
   * generated angle just repoints this at that draft's id; it does NOT
   * always equal drafts[drafts.length - 1], e.g. after a reviewer switches
   * back to an angle that was drafted earlier and hasn't been revised
   * since. Null only before the pipeline has produced a first draft. */
  chosen_draft_id: string | null;
  /** Additive rubric criteria chosen at intake for this request only (§13)
   * — empty for every request created before this existed. Threaded into
   * evaluateDraft (mock and real) so each one gets scored like a default
   * criterion, just tagged `scope: "custom"`. */
  custom_rubric_criteria: CustomRubricCriterion[];
  status: RequestStatus;
  failure_reason: string | null;
  submitted_by: string; // profile id
  reviewer_ids: string[]; // profile ids (request_reviewers)
  created_at: string;
  updated_at: string;
}

export interface SourceRef {
  id: string;
  request_id: string;
  url: string;
  title: string;
  retrieved_at: string;
  selected: boolean;
  relevance_note: string | null;
  /** Full scraped text (real mode only — matches supabase/schema.sql's
   * sources.raw_text). Optional so mock mode's fabricated SourceRef objects
   * (which have no real page to have scraped) don't need to set it; real
   * mode always sets it, and it's what generateDraft/evaluateDraft/
   * reviseDraft actually cite from and check claims against — see
   * generate.real.ts's 2026-09-17 fix (previously they only saw each
   * source's title/url/relevance_note, never its actual content). */
  raw_text?: string | null;
}

export interface DraftSection {
  heading: string;
  body: string;
  cited_source_ids: string[];
}

export interface Draft {
  id: string;
  request_id: string;
  version: number;
  option_label: string;
  title: string;
  sections: DraftSection[];
  generated_by: "system_initial" | "system_revision" | "human_requested" | "human_edited";
  created_at: string;
  /** Bumped on every manual section edit to this draft (2026-09-18 fix —
   * see DraftReviewPanel/DraftViewer's doc comments). A reviewer editing a
   * `human_edited` draft repeatedly no longer creates a new version per
   * save; edits mutate this same draft row in place, so `updated_at` (not
   * `created_at`, which stays fixed at whenever the version was first
   * produced) is what actually moves. Equal to created_at until the first
   * edit. */
  updated_at: string;
}

export interface RubricScore {
  criterion: string;
  scope: "default" | "custom";
  score: number; // 0-10
  notes: string;
}

export interface Evaluation {
  id: string;
  draft_id: string;
  round: number;
  status: "pass" | "revise" | "reject";
  scores: RubricScore[];
  unsupported_claims: string[];
  sections_needing_revision: string[];
  created_at: string;
}

export interface ChannelAsset {
  id: string;
  request_id: string;
  draft_id: string;
  channel: Channel;
  content: string;
  status: "draft" | "ready_to_publish" | "published" | "failed";
}

export type ActivityAction =
  | "submit_request"
  | "complete_research"
  | "select_option"
  | "switch_to_existing_draft"
  | "evaluate_draft"
  | "regenerate_draft"
  | "edit_section"
  | "prepare_channel_assets"
  | "revision_failed"
  | "retry_revision"
  | "approve"
  | "reject"
  | "request_changes"
  | "add_reviewer"
  | "remove_attachment"
  | "retry_pipeline";

export interface ActivityLogEntry {
  id: string;
  request_id: string;
  actor_type: "system" | "human";
  actor_id: string | null; // profile id, or null for system
  actor_name: string; // denormalized for display convenience in mock mode
  action: ActivityAction;
  target: string | null;
  notes: string | null;
  created_at: string;
}

/** A single row in review_decisions — the table with the UNIQUE constraint
 * (DESIGN.md §6) that makes "first decisive action wins" airtight rather
 * than an app-level check-then-act race. */
export interface ReviewDecision {
  id: string;
  draft_id: string;
  action: "approve" | "reject" | "request_changes";
  reviewer_id: string;
  notes: string | null;
  decided_at: string;
}

/** Everything the review screen needs for one request, joined together —
 * this is the shape src/lib/data.ts's getRequestDetail() returns. */
export interface RequestDetail {
  request: ContentRequest;
  submitter: Profile;
  reviewers: Profile[];
  sources: SourceRef[];
  drafts: Draft[]; // all versions, ordered
  evaluations: Evaluation[]; // all rounds, across all drafts
  channelAssets: ChannelAsset[];
  activity: ActivityLogEntry[];
  decision: ReviewDecision | null; // set once a reviewer has decided
}
