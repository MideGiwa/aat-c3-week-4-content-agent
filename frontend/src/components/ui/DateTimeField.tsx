// Shared date/datetime input (2026-09-18 UI polish pass). This deliberately
// keeps the native `<input type="date">`/`type="datetime-local">` rather
// than building or importing a custom calendar widget — the native input
// already gives a real, accessible, OS-consistent date picker for free
// (keyboard input, locale-aware formatting, no extra JS), and ReviewActions'
// existing "past dates can't be selected" behavior is a `min` attribute the
// browser itself enforces. What was actually missing was consistent chrome
// around it: no border/focus treatment matched the rest of the form, and
// there was no visual cue distinguishing "this field opens a picker" from a
// plain text field. This adds a calendar icon and the same border/focus
// styling every other field in the app now shares (inputClasses).

import type { InputHTMLAttributes } from "react";
import { inputClasses } from "./TextInput";

export default function DateTimeField({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative inline-block">
      <svg
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
      >
        <rect x="3" y="4.5" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 8h14M6.5 3v3M13.5 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input className={`${inputClasses} pl-8 ${className}`} {...rest} />
    </div>
  );
}
