import { listRequests } from "@/lib/data";
import KanbanBoard from "@/components/board/KanbanBoard";

export const dynamic = "force-dynamic"; // always read the latest mock/live state

export default async function BoardPage() {
  const requests = await listRequests();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Requests</h1>
        <p className="text-sm text-slate-500">
          Every content request, grouped by where it is in the pipeline. Click a card to open it.
        </p>
      </div>
      <KanbanBoard requests={requests} />
    </div>
  );
}
