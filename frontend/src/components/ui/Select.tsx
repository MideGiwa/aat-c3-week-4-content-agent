// Shared select primitive (2026-09-18 UI polish pass). A bare `<select>`
// renders its own browser-native arrow, at a size and style that doesn't
// match anything else in the form (and looks noticeably different between
// Chrome, Firefox and Safari). This hides that native arrow
// (`appearance-none`) and draws a consistent chevron on top instead, while
// keeping the actual <select> element underneath — still a real native
// dropdown (keyboard-operable, works with autofill/password managers,
// opens the OS's own option list), just consistently styled.

import type { ReactNode, SelectHTMLAttributes } from "react";

export default function Select({
  className = "",
  children,
  ...rest
}: {
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={`w-full appearance-none rounded-md border border-slate-300 bg-white text-sm text-slate-700 p-2 pr-8
          hover:border-slate-400 focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30
          disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer transition-colors ${className}`}
        {...rest}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
      >
        <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
