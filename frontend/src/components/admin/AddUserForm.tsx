"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import { TextInput } from "../ui/TextInput";

const ROLE_OPTIONS = ["content_manager", "reviewer", "admin"] as const;

const MIN_PASSWORD_LENGTH = 8;

export default function AddUserForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["reviewer"]);
  // Default to "invite" (the original behavior, unchanged). "password" is
  // the 2026-09-18 addition — lets an admin hand someone working
  // credentials directly instead of sending an invite email, which matters
  // specifically because Supabase's default plan caps outgoing auth emails
  // at 2/hour (same reason /login grew a password tab in the first place).
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function toggleRole(role: string) {
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "password" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setStatus("saving");
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, roles, password: mode === "password" ? password : undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Could not add that user.");
        return;
      }
      setSuccess(
        mode === "password"
          ? `Created ${email} with the password you set — they can sign in right away, no email sent.`
          : `Invited ${email}. They'll get an email with a sign-in link.`
      );
      setName("");
      setEmail("");
      setRoles(["reviewer"]);
      setPassword("");
      setMode("invite");
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
        <TextInput required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <TextInput required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Roles</label>
        <div className="flex gap-3">
          {ROLE_OPTIONS.map((role) => (
            <Checkbox
              key={role}
              label={role}
              checked={roles.includes(role)}
              onChange={() => toggleRole(role)}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Sign-in method</label>
        <div className="flex gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="add-user-mode"
              checked={mode === "invite"}
              onChange={() => setMode("invite")}
              className="accent-accent-600"
            />
            Send invite email
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="add-user-mode"
              checked={mode === "password"}
              onChange={() => setMode("password")}
              className="accent-accent-600"
            />
            Set a password now
          </label>
        </div>
        {mode === "password" && (
          <p className="text-xs text-slate-500 mt-1">
            No email sent — useful once you&apos;ve hit Supabase&apos;s default 2/hour auth email limit. They can sign
            in immediately from the &quot;Password&quot; tab on the login page.
          </p>
        )}
      </div>
      {mode === "password" && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
          <TextInput
            required
            type="password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      <Button type="submit" size="sm" loading={status === "saving"} className="self-start">
        {status === "saving" ? "Saving…" : mode === "password" ? "Create user" : "Invite user"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}
    </form>
  );
}
