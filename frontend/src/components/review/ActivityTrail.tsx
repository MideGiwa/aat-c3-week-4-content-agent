import type { ActivityLogEntry } from "@/lib/types";

const ACTION_LABEL: Record<ActivityLogEntry["action"], string> = {
  submit_request: "submitted the request",
  complete_research: "completed research and source curation",
  select_option: "selected a content angle",
  switch_to_existing_draft: "switched to a previously generated version — no regeneration needed",
  evaluate_draft: "evaluated the draft against the rubric",
  regenerate_draft: "regenerated the draft",
  edit_section: "manually edited a section",
  revision_failed: "automatic revision failed",
  retry_revision: "retried the automatic revision",
  prepare_channel_assets: "prepared channel-specific copy",
  approve: "approved",
  reject: "rejected",
  request_changes: "requested changes",
  add_reviewer: "added a reviewer",
  remove_attachment: "removed an attachment",
  retry_pipeline: "retried the pipeline after a failure",
};

export default function ActivityTrail({ entries }: { entries: ActivityLogEntry[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Activity</h3>
      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="text-xs">
            <p className="text-slate-700">
              <span className="font-medium">{entry.actor_name}</span>{" "}
              {ACTION_LABEL[entry.action]}
              {entry.actor_type === "system" && (
                <span className="text-slate-400"> (automatic)</span>
              )}
            </p>
            {entry.notes && <p className="text-slate-400 mt-0.5 italic">"{entry.notes}"</p>}
            <p className="text-slate-300 mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
          </li>
        ))}
        {entries.length === 0 && <li className="text-xs text-slate-400">No activity yet.</li>}
      </ol>
    </div>
  );
}
