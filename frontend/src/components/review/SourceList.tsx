"use client";

// Copy-to-clipboard for sources — a per-source icon (copies "Title — URL",
// handy for pasting a citation into notes or a follow-up email) plus a
// "Copy all" button above the list that copies every used source the same
// way, one per line, so a reviewer doesn't have to click through each one.

import { useState } from "react";
import type { DraftSection, SourceRef } from "@/lib/types";

function formatSource(s: SourceRef): string {
  return `${s.title} — ${s.url}`;
}

// Reverse of what DraftViewer already shows (PRODUCTION-READINESS-UX-PLAN.md
// "Next" item 5) — a section already lists which sources support it
// (cited_source_ids), but there was no way to go the other direction:
// given a source, which section(s) actually use it. Built from the active
// draft's sections, which the caller already has in hand — no new data
// fetch, just a different grouping over data already loaded.
function sectionsCitingSource(sourceId: string, sections: DraftSection[]): string[] {
  return sections.filter((s) => s.cited_source_ids.includes(sourceId)).map((s) => s.heading);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — fail
      // quietly rather than showing an error for a low-stakes convenience
      // action.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 text-xs font-medium text-slate-400 hover:text-accent-700"
      title={label}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export default function SourceList({
  sources,
  citingSections = [],
}: {
  sources: SourceRef[];
  /** The active draft's sections, used only to build the "cited in" list
   * below each used source. Optional and defaults to empty so every
   * existing caller keeps working unchanged if it doesn't have a draft to
   * pass yet (e.g. a request with sources but no draft generated). */
  citingSections?: DraftSection[];
}) {
  const selected = sources.filter((s) => s.selected);
  const rejected = sources.filter((s) => !s.selected);
  const allSelectedText = selected.map(formatSource).join("\n");

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Sources ({selected.length} used{rejected.length > 0 ? `, ${rejected.length} not used` : ""})
        </h3>
        {selected.length > 0 && <CopyButton text={allSelectedText} label="Copy all" />}
      </div>
      <ul className="space-y-2">
        {selected.map((s) => {
          const citedIn = sectionsCitingSource(s.id, citingSections);
          return (
            <li key={s.id} className="text-xs flex items-start justify-between gap-2">
              <div className="min-w-0 break-words">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-700 hover:underline font-medium"
                >
                  {s.title}
                </a>
                {s.relevance_note && <p className="text-slate-400 mt-0.5">{s.relevance_note}</p>}
                {citingSections.length > 0 && (
                  <p className="text-slate-400 mt-0.5">
                    {citedIn.length > 0 ? (
                      <>Cited in: {citedIn.join(", ")}</>
                    ) : (
                      <span className="text-amber-600">Not cited in the current draft</span>
                    )}
                  </p>
                )}
              </div>
              <CopyButton text={formatSource(s)} />
            </li>
          );
        })}
      </ul>

      {rejected.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-slate-400 cursor-pointer">
            Considered but not used ({rejected.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {rejected.map((s) => (
              <li key={s.id} className="text-xs text-slate-400 flex items-start justify-between gap-2">
                <span className="min-w-0 break-words">
                  {s.title}
                  {s.relevance_note && <span> — {s.relevance_note}</span>}
                </span>
                <CopyButton text={formatSource(s)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
