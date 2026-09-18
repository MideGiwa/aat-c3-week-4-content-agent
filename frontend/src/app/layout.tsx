import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { USE_MOCK_DATA } from "@/lib/config";
import { getCurrentProfileId } from "@/lib/currentUser";
import { getProfile } from "@/lib/data";

export const metadata: Metadata = {
  title: "Content Ops Console",
  description: "AI Content Research & Publishing Agent — request and review console",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Two calls instead of one so we can tell "no session" apart from
  // "session, no profile row" and show a clear message for the latter.
  const profileId = await getCurrentProfileId();
  const profile = profileId ? await getProfile(profileId) : null;
  const accountPending = !USE_MOCK_DATA && profileId !== null && profile === null;
  const isAdmin = profile?.roles.includes("admin") ?? false;

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
              <Link href="/board" className="font-semibold text-slate-900">
                Content Ops Console
              </Link>
              <div className="flex items-center gap-4">
                {USE_MOCK_DATA && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                    Mock data mode
                  </span>
                )}
                {!USE_MOCK_DATA && profile && (
                  <span className="text-xs text-slate-500">{profile.email}</span>
                )}
                {!USE_MOCK_DATA && isAdmin && (
                  <Link href="/admin/users" className="text-sm font-medium text-slate-600 hover:text-slate-900">
                    Manage users
                  </Link>
                )}
                {profile && (
                  <Link
                    href="/requests/new"
                    className="text-sm font-medium bg-accent-600 text-white px-3 py-1.5 rounded-md hover:bg-accent-700"
                  >
                    + New Request
                  </Link>
                )}
                {!USE_MOCK_DATA && (profile || accountPending) && (
                  <form action="/api/auth/signout" method="post">
                    <button type="submit" className="text-sm text-slate-500 hover:text-slate-700">
                      Sign out
                    </button>
                  </form>
                )}
              </div>
            </div>
          </header>
          <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
            {accountPending ? (
              <div className="max-w-md mx-auto mt-12 text-center">
                <h1 className="text-lg font-semibold text-slate-900">Account not set up yet</h1>
                <p className="mt-2 text-sm text-slate-500">
                  You're signed in, but there's no profile for this account yet — an admin needs to
                  add you from <span className="font-mono text-xs">/admin/users</span> before you can
                  use the console. If you think this is a mistake, sign out and try a different
                  email, or ask an existing admin to add this one.
                </p>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </body>
    </html>
  );
}
