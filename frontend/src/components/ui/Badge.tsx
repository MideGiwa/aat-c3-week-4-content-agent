// Shared status-pill primitive (2026-09-18 UI polish pass). StatusBadge,
// EvaluationPanel, ChannelAssetsPanel, and VersionHistory each defined their
// own tone→color map independently (bg-emerald-100/text-emerald-800 for
// "good," bg-amber-100/text-amber-800 for "needs attention," etc.) with
// slightly different padding/sizing each time. This is the one place that
// mapping lives now — the same five tones cover every status pill in the
// app.

import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  accent: "bg-accent-100 text-accent-700",
};

export default function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
