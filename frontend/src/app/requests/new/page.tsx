import Link from "next/link";
import { listProfiles } from "@/lib/data";
import { getCurrentProfileId } from "@/lib/currentUser";
import NewRequestForm from "@/components/forms/NewRequestForm";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const profiles = await listProfiles();
  // Always populated here in practice: mock mode has MOCK_CURRENT_PROFILE_ID,
  // and middleware.ts refuses an unauthenticated request in real mode before
  // this Server Component ever renders. The "" fallback is just to satisfy
  // NewRequestForm's string prop type.
  const currentProfileId = await getCurrentProfileId();

  return (
    <div>
      <Link href="/board" className="text-xs text-accent-700 hover:underline">
        ← Back to board
      </Link>

      <div className="mt-2 mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New content request</h1>
        <p className="text-sm text-slate-500">
          This goes straight into the pipeline — research and drafting start automatically once
          it's submitted.
        </p>
      </div>
      <NewRequestForm profiles={profiles} currentProfileId={currentProfileId ?? ""} />
    </div>
  );
}
