"use client";

// "Needs my attention" filter (PRODUCTION-READINESS-UX-PLAN.md "Now" item
// 1) — added the same day RLS visibility opened up to everyone (see
// DESIGN.md's decisions log), which is exactly what made this necessary:
// before that change, what a reviewer's own session could even see doubled
// as a personal queue for free. Now the board shows every request to
// everyone, so this is a client-side display filter (not a new query, and
// not a new RLS policy — visibility is deliberately universal now, this is
// just about what's scannable) scoped to requests where the signed-in
// profile is listed as a reviewer. Defaults to "All" so nothing changes for
// anyone who doesn't touch the toggle.

import { useState } from "react";
import type { ContentRequest } from "@/lib/types";
import { BOARD_COLUMNS, boardColumnForStatus } from "@/lib/board";
import RequestCard from "./RequestCard";

export default function KanbanBoard({
  requests,
  currentProfileId,
}: {
  requests: ContentRequest[];
  currentProfileId: string | null;
}) {
  const [onlyMine, setOnlyMine] = useState(false);

  const myRequestCount = currentProfileId
    ? requests.filter((r) => r.reviewer_ids.includes(currentProfileId)).length
    : 0;
  const visibleRequests =
    onlyMine && currentProfileId
      ? requests.filter((r) => r.reviewer_ids.includes(currentProfileId))
      : requests;

  return (
    <div>
      {currentProfileId && (
        <div className="mb-4 flex gap-1">
          <button
            onClick={() => setOnlyMine(false)}
            className={`text-xs font-medium px-3 py-1.5 rounded-md border ${
              !onlyMine
                ? "border-accent-500 bg-accent-50 text-accent-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
          >
            All requests ({requests.length})
          </button>
          <button
            onClick={() => setOnlyMine(true)}
            className={`text-xs font-medium px-3 py-1.5 rounded-md border ${
              onlyMine
                ? "border-accent-500 bg-accent-50 text-accent-700"
                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
            }`}
          >
            Needs my attention ({myRequestCount})
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {BOARD_COLUMNS.map((column) => {
          const items = visibleRequests.filter((r) => boardColumnForStatus(r.status) === column.key);
          return (
            <div key={column.key} className="bg-slate-100/60 rounded-xl p-3 min-h-[200px]">
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-sm font-semibold text-slate-700">{column.label}</h2>
                <span className="text-xs text-slate-400">{items.length}</span>
              </div>
              <div className="space-y-3">
                {items.map((request) => (
                  <RequestCard key={request.id} request={request} />
                ))}
                {items.length === 0 && (
                  <p className="text-xs text-slate-400 px-1">Nothing here right now.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
