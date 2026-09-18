import LoginForm from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const redirectTo = searchParams.next ?? "/board";

  return (
    <div className="max-w-sm mx-auto mt-12">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">Content Ops Console</p>
      <LoginForm redirectTo={redirectTo} />
    </div>
  );
}
