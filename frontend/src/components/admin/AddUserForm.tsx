"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLE_OPTIONS = ["content_manager", "reviewer", "admin"] as const;

export default function AddUserForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["reviewer"]);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function toggleRole(role: string) {
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, roles }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Could not add that user.");
        return;
      }
      setSuccess(`Invited ${email}. They'll get an email with a sign-in link.`);
      setName("");
      setEmail("");
      setRoles(["reviewer"]);
      // The "Existing users" list below this form is server-rendered — same
      // no-reload-update pattern the rest of the app uses (found via
      // 2026-09-18 UI audit: this list used to go stale until a manual
      // page reload).
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-slate-200 rounded-md bg-white p-4 flex flex-col gap-3 max-w-md"
    >
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Roles</label>
        <div className="flex gap-3">
          {ROLE_OPTIONS.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
              {role}
            </label>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={status === "saving"}
        className="self-start text-sm font-medium bg-accent-600 text-white px-3 py-1.5 rounded-md hover:bg-accent-700 disabled:opacity-50"
      >
        {status === "saving" ? "Sending invite…" : "Invite user"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}
    </form>
  );
}
