import type {
  ActivityLogEntry,
  ChannelAsset,
  ContentRequest,
  Draft,
  Evaluation,
  Profile,
  RequestAttachment,
  ReviewDecision,
  SourceRef,
} from "../types";

// Sample data standing in for Supabase in mock mode. Deliberately covers a
// spread of states — one item per PRD test scenario where practical — so
// the board and review screens have something meaningful to show without
// any live backend. Nothing here is fetched from a real database.

export const seedProfiles: Profile[] = [
  { id: "profile-mide", name: "Mide Giwa", email: "olamidegiwa21@gmail.com", roles: ["content_manager", "reviewer", "admin"] },
  { id: "profile-ada", name: "Ada Okafor", email: "ada@koyatalent.com", roles: ["reviewer"] },
  { id: "profile-sam", name: "Sam Reyes", email: "sam@koyatalent.com", roles: ["reviewer"] },
];

export const seedRequests: ContentRequest[] = [
  {
    id: "req-1",
    idea_or_topic: "How AI is changing hiring and resume screening",
    target_audience: "HR leaders at mid-size companies",
    source_url: "https://www.shrm.org/topics-tools/news/ai-hiring",
    tone: "professional",
    priority_channels: ["linkedin", "x"],
    publish_timing: null, // not yet approved — nothing decided
    scheduled_for: null,
    title_options: [
      "How AI Is Quietly Rewriting the Hiring Playbook",
      "Is AI Finally Changing How Companies Hire?",
    ],
    chosen_title_index: 0,
    title_option_reason:
      "Direct framing reads clearer for a professional/authoritative tone and states the payoff up front.",
    chosen_draft_id: "draft-2", // latest version (v2, post auto-revision) is the active one
    // Added at intake — matches the pre-existing "Hook Strength" custom
    // score already seeded below in eval-1/eval-2, now shown as having
    // actually been requested rather than appearing in evaluations with no
    // origin in the request itself.
    custom_rubric_criteria: [
      {
        name: "Hook Strength",
        description:
          "Does the opening line earn a read, especially on LinkedIn (truncates after ~3 lines) and X (no second chance)?",
      },
    ],
    status: "pending_human_review",
    failure_reason: null,
    submitted_by: "profile-mide",
    reviewer_ids: ["profile-ada", "profile-sam"],
    created_at: "2026-09-15T10:00:00Z",
    updated_at: "2026-09-16T09:00:00Z",
  },
  {
    id: "req-2",
    idea_or_topic: "Q3 recap: three hiring trends worth watching",
    target_audience: "Talent acquisition teams",
    source_url: null,
    tone: "casual",
    priority_channels: ["linkedin", "x", "newsletter"],
    publish_timing: null, // still drafting — not approved, nothing decided
    scheduled_for: null,
    title_options: null,
    chosen_title_index: null,
    title_option_reason: null,
    chosen_draft_id: null, // still drafting — no draft exists yet
    custom_rubric_criteria: [],
    status: "drafting",
    failure_reason: null,
    submitted_by: "profile-mide",
    reviewer_ids: ["profile-ada"],
    created_at: "2026-09-16T08:00:00Z",
    updated_at: "2026-09-16T08:30:00Z",
  },
  {
    id: "req-3",
    idea_or_topic: "5 practical tips for running a remote-first hiring process",
    target_audience: "Startup founders hiring their first remote team",
    source_url: null,
    tone: "professional",
    priority_channels: ["linkedin"],
    // Approved with a future publish date — demonstrates the "scheduled"
    // branch now that unapproved requests never carry a publish_timing.
    publish_timing: "scheduled",
    scheduled_for: "2026-09-20T14:00:00Z",
    title_options: null,
    chosen_title_index: null,
    title_option_reason: null,
    chosen_draft_id: "draft-3",
    custom_rubric_criteria: [],
    status: "approved",
    failure_reason: null,
    submitted_by: "profile-mide",
    reviewer_ids: ["profile-sam"],
    created_at: "2026-09-14T12:00:00Z",
    updated_at: "2026-09-15T16:00:00Z",
  },
  {
    id: "req-4",
    idea_or_topic: "nviwbfvwug397hfwp939fh4",
    target_audience: "n/a",
    source_url: null,
    tone: "professional",
    priority_channels: ["linkedin"],
    publish_timing: null, // never reached approval
    scheduled_for: null,
    title_options: null,
    chosen_title_index: null,
    title_option_reason: null,
    chosen_draft_id: null, // research failed before any draft was produced
    custom_rubric_criteria: [],
    status: "research_failed",
    failure_reason: "no_search_results",
    submitted_by: "profile-mide",
    reviewer_ids: [],
    created_at: "2026-09-16T07:00:00Z",
    updated_at: "2026-09-16T07:01:00Z",
  },
  {
    id: "req-5",
    idea_or_topic: "Why employer branding matters more in a tight labor market",
    target_audience: "Marketing + HR cross-functional teams",
    source_url: "https://hbr.org/employer-branding",
    tone: "professional",
    priority_channels: ["linkedin", "x", "newsletter"],
    publish_timing: "immediately",
    scheduled_for: null,
    title_options: null,
    chosen_title_index: null,
    title_option_reason: null,
    chosen_draft_id: "draft-5",
    custom_rubric_criteria: [],
    status: "published",
    failure_reason: null,
    submitted_by: "profile-mide",
    reviewer_ids: ["profile-ada"],
    created_at: "2026-09-10T09:00:00Z",
    updated_at: "2026-09-12T09:00:00Z",
  },
  {
    id: "req-6",
    idea_or_topic: "Should companies still require cover letters in 2026?",
    target_audience: "Recruiters and hiring managers",
    source_url: null,
    tone: "conversational",
    priority_channels: ["linkedin", "x"],
    publish_timing: null, // reviewer requested changes — not approved yet
    scheduled_for: null,
    title_options: null,
    chosen_title_index: null,
    title_option_reason: null,
    chosen_draft_id: "draft-4",
    custom_rubric_criteria: [],
    status: "needs_manual_revision",
    failure_reason: null,
    submitted_by: "profile-mide",
    reviewer_ids: ["profile-ada", "profile-sam"],
    created_at: "2026-09-15T13:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
  },
];

export const seedAttachments: RequestAttachment[] = [
  {
    id: "att-1",
    request_id: "req-2",
    file_type: "spreadsheet",
    file_name: "q3-hiring-metrics.xlsx",
    status: "uploaded",
    uploaded_at: "2026-09-16T08:00:00Z",
    removed_at: null,
  },
];

export const seedSources: SourceRef[] = [
  { id: "src-1", request_id: "req-1", url: "https://www.shrm.org/topics-tools/news/ai-hiring", title: "SHRM: How AI Is Reshaping Recruitment", retrieved_at: "2026-09-15T10:05:00Z", selected: true, relevance_note: "Directly covers AI resume screening adoption rates." },
  { id: "src-2", request_id: "req-1", url: "https://hbr.org/ai-hiring-bias", title: "HBR: The Bias Risk in AI Hiring Tools", retrieved_at: "2026-09-15T10:06:00Z", selected: true, relevance_note: "Balances the piece with a fairness/bias angle." },
  { id: "src-3", request_id: "req-1", url: "https://example.com/unrelated-marketing-post", title: "Unrelated marketing listicle", retrieved_at: "2026-09-15T10:06:30Z", selected: false, relevance_note: "Below relevance floor — not about hiring or AI." },
  { id: "src-4", request_id: "req-3", url: "https://remote.co/remote-hiring-guide", title: "Remote.co: A Guide to Remote-First Hiring", retrieved_at: "2026-09-14T12:10:00Z", selected: true, relevance_note: "Core reference for the whole piece." },
  { id: "src-5", request_id: "req-6", url: "https://www.linkedin.com/pulse/cover-letters-2026", title: "Are Cover Letters Still Worth It?", retrieved_at: "2026-09-15T13:10:00Z", selected: true, relevance_note: "Primary counter-argument source." },
  { id: "src-6", request_id: "req-5", url: "https://hbr.org/employer-branding", title: "HBR: Why Employer Branding Is a Recruiting Multiplier", retrieved_at: "2026-09-10T09:05:00Z", selected: true, relevance_note: "Provided directly with the request — the core argument for the whole piece." },
];

export const seedDrafts: Draft[] = [
  {
    id: "draft-1",
    request_id: "req-1",
    version: 1,
    option_label: "A",
    title: "How AI Is Quietly Rewriting the Hiring Playbook",
    sections: [
      { heading: "The shift already underway", body: "Most mid-size companies now use some form of automated resume screening...", cited_source_ids: ["src-1"] },
      { heading: "Where it helps — and where it doesn't", body: "AI screening speeds up the top of the funnel, but bias risk remains real if training data isn't audited...", cited_source_ids: ["src-1", "src-2"] },
      { heading: "What HR leaders should do next", body: "Start with a bias audit of any tool before rollout, and keep a human in the loop for borderline cases...", cited_source_ids: ["src-2"] },
    ],
    generated_by: "system_initial",
    created_at: "2026-09-15T11:00:00Z",
    updated_at: "2026-09-15T11:00:00Z",
  },
  {
    id: "draft-2",
    request_id: "req-1",
    version: 2,
    option_label: "A",
    title: "How AI Is Quietly Rewriting the Hiring Playbook",
    sections: [
      { heading: "The shift already underway", body: "Most mid-size companies now use some form of automated resume screening, per SHRM's latest survey...", cited_source_ids: ["src-1"] },
      { heading: "Where it helps — and where it doesn't", body: "AI screening speeds up the top of the funnel, but HBR's reporting on bias risk shows the danger if training data isn't audited...", cited_source_ids: ["src-1", "src-2"] },
      { heading: "What HR leaders should do next", body: "Start with a bias audit of any tool before rollout, and keep a human in the loop for borderline cases...", cited_source_ids: ["src-2"] },
    ],
    generated_by: "system_revision",
    created_at: "2026-09-16T08:45:00Z",
    updated_at: "2026-09-16T08:45:00Z",
  },
  {
    id: "draft-3",
    request_id: "req-3",
    version: 1,
    option_label: "A",
    title: "5 Practical Tips for Running a Remote-First Hiring Process",
    sections: [
      { heading: "Write the job post for remote from day one", body: "Don't bolt 'remote OK' onto an office-first posting...", cited_source_ids: ["src-4"] },
      { heading: "Rethink your interview loop", body: "Async steps early, live conversation later...", cited_source_ids: ["src-4"] },
    ],
    generated_by: "system_initial",
    created_at: "2026-09-14T13:00:00Z",
    updated_at: "2026-09-14T13:00:00Z",
  },
  {
    id: "draft-4",
    request_id: "req-6",
    version: 1,
    option_label: "A",
    title: "Should Cover Letters Still Exist in 2026?",
    sections: [
      { heading: "The case against", body: "Most are unread, most are generic, and most add friction for candidates...", cited_source_ids: ["src-5"] },
      { heading: "The case for, narrowly", body: "For a small number of roles a cover letter still signals genuine intent...", cited_source_ids: [] },
    ],
    generated_by: "system_initial",
    created_at: "2026-09-15T14:00:00Z",
    updated_at: "2026-09-15T14:00:00Z",
  },
  {
    id: "draft-5",
    request_id: "req-5",
    version: 1,
    option_label: "A",
    title: "Why Employer Branding Matters More in a Tight Labor Market",
    sections: [
      { heading: "Why this matters now", body: "Employer branding isn't a 'nice to have' anymore — it's doing more of your recruiting than your job ads are, especially as candidates have more leverage in a tight labor market.", cited_source_ids: ["src-6"] },
      { heading: "What the research shows", body: "HBR's reporting is consistent: candidates research a company's reputation long before they ever see a job post, and a weak employer brand quietly inflates cost-per-hire even when nobody names it as the reason.", cited_source_ids: ["src-6"] },
      { heading: "What to do next", body: "Treat employer branding as a marketing + HR joint effort, not an HR-only checkbox — start by auditing what candidates actually see when they search your company name.", cited_source_ids: ["src-6"] },
    ],
    generated_by: "system_initial",
    created_at: "2026-09-10T09:30:00Z",
    updated_at: "2026-09-10T09:30:00Z",
  },
];

export const seedEvaluations: Evaluation[] = [
  {
    id: "eval-1",
    draft_id: "draft-1",
    round: 1,
    status: "revise",
    scores: [
      { criterion: "Topic Relevance", scope: "default", score: 9, notes: "On topic throughout." },
      { criterion: "Source Grounding", scope: "default", score: 6, notes: "Section 1 doesn't explicitly attribute the stat to SHRM." },
      { criterion: "Factual Consistency", scope: "default", score: 8, notes: "No contradictions found." },
      { criterion: "Audience Fit", scope: "default", score: 8, notes: "Appropriate depth for HR leaders." },
      { criterion: "Tone", scope: "default", score: 8, notes: "Matches professional brand voice." },
      { criterion: "SEO Fit", scope: "default", score: 7, notes: "Primary keyword present but not in first 100 words." },
      { criterion: "Channel Fit", scope: "default", score: 8, notes: "N/A at article stage." },
      { criterion: "Clarity", scope: "default", score: 8, notes: "Easy to follow." },
      { criterion: "Completeness", scope: "default", score: 8, notes: "All sections present." },
      { criterion: "Hook Strength", scope: "custom", score: 6, notes: "Opening sentence is a bit flat for LinkedIn." },
    ],
    unsupported_claims: ["\"Most mid-size companies\" stat needs an explicit source attribution."],
    sections_needing_revision: ["The shift already underway", "Where it helps — and where it doesn't"],
    created_at: "2026-09-15T11:05:00Z",
  },
  {
    id: "eval-2",
    draft_id: "draft-2",
    round: 2,
    status: "pass",
    scores: [
      { criterion: "Topic Relevance", scope: "default", score: 9, notes: "On topic throughout." },
      { criterion: "Source Grounding", scope: "default", score: 9, notes: "Attribution now explicit in both flagged sections." },
      { criterion: "Factual Consistency", scope: "default", score: 9, notes: "No contradictions found." },
      { criterion: "Audience Fit", scope: "default", score: 8, notes: "Appropriate depth for HR leaders." },
      { criterion: "Tone", scope: "default", score: 8, notes: "Matches professional brand voice." },
      { criterion: "SEO Fit", scope: "default", score: 8, notes: "Keyword placement improved." },
      { criterion: "Channel Fit", scope: "default", score: 8, notes: "N/A at article stage." },
      { criterion: "Clarity", scope: "default", score: 9, notes: "Easy to follow." },
      { criterion: "Completeness", scope: "default", score: 9, notes: "All sections present." },
      { criterion: "Hook Strength", scope: "custom", score: 7, notes: "Improved, still could be punchier." },
    ],
    unsupported_claims: [],
    sections_needing_revision: [],
    created_at: "2026-09-16T08:50:00Z",
  },
  {
    id: "eval-3",
    draft_id: "draft-3",
    round: 1,
    status: "pass",
    scores: [
      { criterion: "Topic Relevance", scope: "default", score: 9, notes: "" },
      { criterion: "Source Grounding", scope: "default", score: 8, notes: "" },
      { criterion: "Factual Consistency", scope: "default", score: 9, notes: "" },
      { criterion: "Audience Fit", scope: "default", score: 9, notes: "" },
      { criterion: "Tone", scope: "default", score: 8, notes: "" },
      { criterion: "SEO Fit", scope: "default", score: 8, notes: "" },
      { criterion: "Channel Fit", scope: "default", score: 8, notes: "" },
      { criterion: "Clarity", scope: "default", score: 9, notes: "" },
      { criterion: "Completeness", scope: "default", score: 8, notes: "" },
    ],
    unsupported_claims: [],
    sections_needing_revision: [],
    created_at: "2026-09-14T13:10:00Z",
  },
  {
    id: "eval-4",
    draft_id: "draft-4",
    round: 2,
    status: "revise",
    scores: [
      { criterion: "Topic Relevance", scope: "default", score: 8, notes: "" },
      { criterion: "Source Grounding", scope: "default", score: 4, notes: "Second section has zero cited sources." },
      { criterion: "Factual Consistency", scope: "default", score: 7, notes: "" },
      { criterion: "Audience Fit", scope: "default", score: 7, notes: "" },
      { criterion: "Tone", scope: "default", score: 7, notes: "" },
      { criterion: "SEO Fit", scope: "default", score: 6, notes: "" },
      { criterion: "Channel Fit", scope: "default", score: 7, notes: "" },
      { criterion: "Clarity", scope: "default", score: 8, notes: "" },
      { criterion: "Completeness", scope: "default", score: 7, notes: "" },
    ],
    unsupported_claims: ["\"a small number of roles\" is asserted with no supporting source."],
    sections_needing_revision: ["The case for, narrowly"],
    created_at: "2026-09-16T10:00:00Z",
  },
  {
    id: "eval-5",
    draft_id: "draft-5",
    round: 1,
    status: "pass",
    scores: [
      { criterion: "Topic Relevance", scope: "default", score: 9, notes: "" },
      { criterion: "Source Grounding", scope: "default", score: 9, notes: "Every section cites the provided HBR source." },
      { criterion: "Factual Consistency", scope: "default", score: 9, notes: "" },
      { criterion: "Audience Fit", scope: "default", score: 8, notes: "" },
      { criterion: "Tone", scope: "default", score: 8, notes: "" },
      { criterion: "SEO Fit", scope: "default", score: 8, notes: "" },
      { criterion: "Channel Fit", scope: "default", score: 8, notes: "" },
      { criterion: "Clarity", scope: "default", score: 9, notes: "" },
      { criterion: "Completeness", scope: "default", score: 8, notes: "" },
    ],
    unsupported_claims: [],
    sections_needing_revision: [],
    created_at: "2026-09-10T09:35:00Z",
  },
];

export const seedChannelAssets: ChannelAsset[] = [
  { id: "ca-1", request_id: "req-3", draft_id: "draft-3", channel: "linkedin", content: "Hiring remote-first? Here are 5 things most teams get wrong...\n\n1. The job post itself...\n\nWhat's worked for your team? Drop a comment.", status: "ready_to_publish" },
  { id: "ca-2", request_id: "req-5", draft_id: "draft-5", channel: "linkedin", content: "Employer branding isn't a 'nice to have' anymore...", status: "published" },
  { id: "ca-3", request_id: "req-5", draft_id: "draft-5", channel: "x", content: "Employer branding is doing more of your recruiting than your job ads are. Here's why 🧵", status: "published" },
  // req-5's third priority channel — generated right alongside LinkedIn/X by
  // the same automated pipeline pass, but sitting at ready_to_publish
  // indefinitely because nothing currently sends newsletters (DESIGN.md
  // §11 "Scope note"). This is the concrete illustration of that scope cut:
  // generated and reviewable, not auto-distributed.
  {
    id: "ca-4",
    request_id: "req-5",
    draft_id: "draft-5",
    channel: "newsletter",
    content:
      "Subject: Why Employer Branding Matters More in a Tight Labor Market\n\nHi there,\n\nEmployer branding isn't a 'nice to have' anymore — it's doing more of your recruiting than your job ads are...\n\n— Sent via the Content Ops pipeline (draft, not yet distributed).",
    status: "ready_to_publish",
  },
  // req-1 (pending_human_review) — channel copy is prepared as the last
  // automated step, before a human ever sees the draft, so it's already
  // sitting here in "draft" status waiting on the same approval that would
  // promote it to ready_to_publish.
  {
    id: "ca-5",
    request_id: "req-1",
    draft_id: "draft-2",
    channel: "linkedin",
    content:
      "How AI Is Quietly Rewriting the Hiring Playbook\n\nMost mid-size companies now use some form of automated resume screening, per SHRM's latest survey...\n\nWhat's your take? Drop a comment below.",
    status: "draft",
  },
  {
    id: "ca-6",
    request_id: "req-1",
    draft_id: "draft-2",
    channel: "x",
    content: "How AI Is Quietly Rewriting the Hiring Playbook — most mid-size companies now use some form of automated resume screening.",
    status: "draft",
  },
  // req-6 (needs_manual_revision) — copy was prepared against the
  // now-flagged draft-4; it'll be superseded the moment a reviewer's
  // "request changes" triggers a regeneration pass (runRevisionPipeline).
  {
    id: "ca-7",
    request_id: "req-6",
    draft_id: "draft-4",
    channel: "linkedin",
    content: "Should Cover Letters Still Exist in 2026?\n\nMost are unread, most are generic, and most add friction for candidates...\n\nWhat's your take? Drop a comment below.",
    status: "draft",
  },
  {
    id: "ca-8",
    request_id: "req-6",
    draft_id: "draft-4",
    channel: "x",
    content: "Should Cover Letters Still Exist in 2026? Most are unread, most are generic, most add friction.",
    status: "draft",
  },
];

export const seedActivity: ActivityLogEntry[] = [
  { id: "act-1", request_id: "req-1", actor_type: "human", actor_id: "profile-mide", actor_name: "Mide Giwa", action: "submit_request", target: null, notes: null, created_at: "2026-09-15T10:00:00Z" },
  { id: "act-2", request_id: "req-1", actor_type: "system", actor_id: null, actor_name: "System", action: "regenerate_draft", target: "draft-2", notes: "Automatic revision after round 1 evaluation flagged two sections.", created_at: "2026-09-16T08:45:00Z" },
  { id: "act-3", request_id: "req-3", actor_type: "human", actor_id: "profile-mide", actor_name: "Mide Giwa", action: "submit_request", target: null, notes: null, created_at: "2026-09-14T12:00:00Z" },
  { id: "act-4", request_id: "req-3", actor_type: "human", actor_id: "profile-sam", actor_name: "Sam Reyes", action: "approve", target: "draft-3", notes: "Reads well, ship it.", created_at: "2026-09-15T16:00:00Z" },
  { id: "act-5", request_id: "req-6", actor_type: "human", actor_id: "profile-ada", actor_name: "Ada Okafor", action: "request_changes", target: "draft-4", notes: "Second section needs a real source for the 'small number of roles' claim.", created_at: "2026-09-16T10:00:00Z" },
];

export const seedDecisions: ReviewDecision[] = [
  { id: "dec-1", draft_id: "draft-3", action: "approve", reviewer_id: "profile-sam", notes: "Reads well, ship it.", decided_at: "2026-09-15T16:00:00Z" },
  { id: "dec-2", draft_id: "draft-4", action: "request_changes", reviewer_id: "profile-ada", notes: "Second section needs a real source for the 'small number of roles' claim.", decided_at: "2026-09-16T10:00:00Z" },
];
