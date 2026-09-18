import { redirect } from "next/navigation";
import { USE_MOCK_DATA } from "@/lib/config";
import { getCurrentProfile } from "@/lib/currentUser";
import { listProfiles } from "@/lib/data";
import AddUserForm from "@/components/admin/AddUserForm";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  if (USE_MOCK_DATA) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Manage users</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-xl">
          User provisioning calls Supabase Auth's admin API, so there's nothing to manage while
          running against the mock store — every mock profile is already seeded in{" "}
          <code>src/lib/mock/seed.ts</code>.
        </p>
      </div>
    );
  }

  const profile = await getCurrentProfile();
  if (!profile || !profile.roles.includes("admin")) {
    redirect("/board");
  }

  const profiles = await listProfiles();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Manage users</h1>
        <p className="text-sm text-slate-500 max-w-xl">
          Add a reviewer or admin — they'll get an email invite with a one-time sign-in link.
          There's no self-serve signup; every account starts here.
        </p>
      </div>

      <AddUserForm />

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Existing users</h2>
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md bg-white">
          {profiles.map((p) => (
            <li key={p.id} className="px-4 py-3 flex items-center justify-between text-sm">
              <span>
                <span className="font-medium text-slate-900">{p.name}</span>{" "}
                <span className="text-slate-500">{p.email}</span>
              </span>
              <span className="text-xs text-slate-500">{p.roles.join(", ") || "no roles"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
