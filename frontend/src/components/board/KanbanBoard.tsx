import type { ContentRequest } from "@/lib/types";
import { BOARD_COLUMNS, boardColumnForStatus } from "@/lib/board";
import RequestCard from "./RequestCard";

export default function KanbanBoard({ requests }: { requests: ContentRequest[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {BOARD_COLUMNS.map((column) => {
        const items = requests.filter((r) => boardColumnForStatus(r.status) === column.key);
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
  );
}
