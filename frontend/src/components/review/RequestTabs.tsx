"use client";

// Moves channel-specific copy out from the very bottom of the page
// (2026-09-18 UI revision note: "The channel copy should not be all the
// way at the bottom of the page") into its own tab, alongside the draft.
// Both panes stay mounted (toggled with `hidden`, not unmounted) so
// switching tabs never loses DraftReviewPanel's own selected-version state.

import { useState } from "react";

export default function RequestTabs({
  draftTab,
  channelCopyTab,
}: {
  draftTab: React.ReactNode;
  channelCopyTab: React.ReactNode;
}) {
  const [tab, setTab] = useState<"draft" | "channel">("draft");

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        <button
          onClick={() => setTab("draft")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "draft"
              ? "border-accent-600 text-accent-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Draft
        </button>
        <button
          onClick={() => setTab("channel")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "channel"
              ? "border-accent-600 text-accent-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Channel Copy
        </button>
      </div>
      <div className={tab === "draft" ? "space-y-4" : "hidden"}>{draftTab}</div>
      <div className={tab === "channel" ? "" : "hidden"}>{channelCopyTab}</div>
    </div>
  );
}
