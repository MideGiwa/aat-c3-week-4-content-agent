// Shared button primitive (2026-09-18 UI polish pass, user-requested:
// "better ui. Buttons, colors, checkboxes, dropdowns, date picker, etc").
// Before this, every button in the app was its own one-off Tailwind class
// string — bg-accent-600/bg-emerald-600/bg-amber-500/bg-red-600/bg-slate-800
// all appeared independently across ReviewActions, ContentAngleSelector,
// LoginForm, NewRequestForm, AddUserForm, DraftViewer, and the retry
// buttons, each with slightly different padding, focus behavior (none of
// them had a visible focus ring beyond the browser default), and disabled
// treatment. This centralizes that into one component with a real variant
// scale, so every button in the app now shares the same sizing, hover/
// active states, and a real focus-visible ring for keyboard users.

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant =
  | "primary"
  | "secondary"
  | "accentOutline"
  | "success"
  | "danger"
  | "dangerOutline"
  | "warning"
  | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-300",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:text-slate-400 disabled:bg-slate-50",
  accentOutline:
    "bg-white text-accent-700 border border-accent-300 hover:bg-accent-50 active:bg-accent-100 disabled:text-accent-300 disabled:bg-white",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-300",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300",
  dangerOutline:
    "bg-white text-red-700 border border-red-300 hover:bg-red-50 active:bg-red-100 disabled:text-red-300 disabled:bg-white",
  warning: "bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700 disabled:bg-amber-300",
  ghost:
    "bg-transparent text-accent-700 hover:bg-accent-50 active:bg-accent-100 disabled:text-slate-400 disabled:bg-transparent",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-xs px-2.5 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2 gap-2",
};

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin h-3.5 w-3.5 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-md transition-colors
        disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1
        ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
