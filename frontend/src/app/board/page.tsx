import { listRequests } from "@/lib/data";
import { getCurrentProfileId } from "@/lib/currentUser";
import KanbanBoard from "@/components/board/KanbanBoard";

export const dynamic = "force-dynamic"; // always read the latest mock/live state

export default async function BoardPage() {
  // Both reads happen regardless of mode/session state — getCurrentProfileId
  // returns MOCK_CURRENT_PROFILE_ID in mock mode and can return null in real
  // mode only in edge cases middleware already guards against for this
  // route, so requests always resolves and currentProfileId is passed
  // through as-is (KanbanBoard handles a null by just not offering the
  // "Needs my attention" filter).
  const [requests, currentProfileId] = await Promise.all([listRequests(), getCurrentProfileId()]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Requests</h1>
        <p className="text-sm text-slate-500">
          Every content request, grouped by where it is in the pipeline. Click a card to open it.
        </p>
      </div>
      <KanbanBoard requests={requests} currentProfileId={currentProfileId} />
    </div>
  );
}
