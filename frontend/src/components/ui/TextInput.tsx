// Shared text input / textarea styling (2026-09-18 UI polish pass). Every
// text input and textarea in the app used the same `rounded-md border
// border-slate-300 text-sm p-2` string, copy-pasted independently in every
// form — and none of them had a visible focus ring beyond whatever the
// browser supplies by default (inconsistent across browsers, and easy to
// miss entirely in some). `inputClasses` is the single definition every
// text-like field now shares; `TextInput`/`Textarea` are thin wrappers for
// new code, while existing `<input className={inputClasses}>` call sites
// keep working unchanged.

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export const inputClasses =
  "w-full rounded-md border border-slate-300 text-sm p-2 placeholder:text-slate-400 " +
  "hover:border-slate-400 focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 " +
  "disabled:bg-slate-50 disabled:text-slate-400 transition-colors";

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClasses} ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClasses} ${className}`} {...rest} />;
}
