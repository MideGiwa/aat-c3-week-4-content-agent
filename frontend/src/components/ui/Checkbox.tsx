// Shared checkbox primitive (2026-09-18 UI polish pass). Every checkbox in
// the app (channel picker, reviewer picker, role picker) was previously a
// bare `<input type="checkbox">` with zero styling — just whatever the
// browser's own default control looks like, sized and colored
// independently of everything else on the page. This uses the CSS
// `accent-color` property (via Tailwind's `accent-*` utility), which
// recolors the native checkbox to match the app's palette while keeping
// the browser's own accessible, keyboard-operable control — no custom SVG
// box or extra DOM needed, and it behaves identically to a plain checkbox
// everywhere else (screen readers, forms, autofill).

import type { InputHTMLAttributes, ReactNode } from "react";

export default function Checkbox({
  label,
  className = "",
  ...rest
}: {
  label: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer select-none ${className}`}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 accent-accent-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1"
        {...rest}
      />
      {label}
    </label>
  );
}
