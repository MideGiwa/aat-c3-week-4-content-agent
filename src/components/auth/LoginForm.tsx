"use client";

import { useState } from "react";

type Mode = "magic_link" | "password";

export default function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [mode, setMode] = useState<Mode>("magic_link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setStatus("idle");
    setError(null);
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    // Belt-and-suspenders alongside the middleware fix (2026-09-18): a
    // network failure, or a response that isn't valid JSON (an HTML error
    // page, say — which is exactly what the middleware bug used to hand
    // back here), used to throw from fetch()/res.json() with nothing
    // catching it, leaving status stuck on "sending" forever with no way
    // out but a page reload. Now any failure at all lands on a visible
    // error instead.
    try {
      const res = await fetch("/api/auth/request-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
        }),
      });
      const result = await res.json();

      if (!result.ok) {
        setStatus("error");
        setError(result.message ?? "Something went wrong. Try again.");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    try {
      const res = await fetch("/api/auth/login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await res.json();

      if (!result.ok) {
        setStatus("error");
        setError(result.message ?? "Something went wrong. Try again.");
        return;
      }

      // Session cookie is already set on this response by the route handler.
      // A full navigation (not router.push) so middleware and every server
      // component re-read auth state against the new cookie from scratch.
      window.location.href = redirectTo;
    } catch {
      setStatus("error");
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
        Check <strong>{email}</strong> for a sign-in link. It expires after a while — if it's been
        a few minutes, just submit the form again for a fresh one.
      </div>
    );
  }

  return (
    <div className="max-w-sm">
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <button
          type="button"
          onClick={() => switchMode("magic_link")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === "magic_link"
              ? "border-accent-600 text-accent-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Email link
        </button>
        <button
          type="button"
          onClick={() => switchMode("password")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === "password"
              ? "border-accent-600 text-accent-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Password
        </button>
      </div>

      {mode === "magic_link" ? (
        <form onSubmit={handleMagicLinkSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-md border border-slate-300 text-sm p-2"
            />
          </div>
          <button
            type="submit"
            disabled={status === "sending" || !email}
            className="self-start text-sm font-medium bg-accent-600 text-white px-4 py-2 rounded-md hover:bg-accent-700 disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-md border border-slate-300 text-sm p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-slate-300 text-sm p-2"
            />
          </div>
          <button
            type="submit"
            disabled={status === "sending" || !email || !password}
            className="self-start text-sm font-medium bg-accent-600 text-white px-4 py-2 rounded-md hover:bg-accent-700 disabled:opacity-50"
          >
            {status === "sending" ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}
      <p className="text-xs text-slate-400 mt-3">Don't have access? Contact your administrator.</p>
    </div>
  );
}
