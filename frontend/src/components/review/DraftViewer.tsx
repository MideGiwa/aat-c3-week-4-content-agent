"use client";

// "Inline edit, but versioned" (2026-09-18 UI revision note: "I should be
// able to edit sections manually"). When `editable`, each section gets an
// Edit affordance that swaps its body for a textarea; Save posts to
// /api/webhooks/manual-edit, which creates a brand-new draft VERSION with
// just that section's body changed (tagged human_edited) rather than
// mutating this one in place — same "never overwrite a version" rule every
// other draft-producing action in this app follows. `editable` is only true
// for the request's active, undecided draft (DraftReviewPanel) — a
// historical version, or one a decision has already been recorded against,
// renders read-only.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Draft, DraftSection, SourceRef } from "@/lib/types";
import MarkdownText from "./MarkdownText";
import Button from "../ui/Button";
import { Textarea } from "../ui/TextInput";

export default function DraftViewer({
  draft,
  sources,
  editable = false,
  requestId,
  previousSections,
}: {
  draft: Draft;
  sources: SourceRef[];
  editable?: boolean;
  requestId?: string;
  /** The prior version's sections in this same angle's revision chain
   * (PRODUCTION-READINESS-UX-PLAN.md "Next" item 3) — undefined for v1 of
   * an angle, where there's nothing to diff against. Matched to the current
   * draft's sections by heading (the same matching key generate.real.ts's
   * revision step itself uses), not by array position, since a revision can
   * reorder or drop sections. Scoped deliberately to "did this section
   * change at all" rather than a word-level diff — see the plan doc for why
   * that's phase one. */
  previousSections?: DraftSection[];
}) {
  const router = useRouter();
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const previousByHeading = new Map((previousSections ?? []).map((s) => [s.heading, s]));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing(idx: number, currentBody: string) {
    setEditingIndex(idx);
    setDraftBody(currentBody);
    setError(null);
  }

  function cancelEditing() {
    setEditingIndex(null);
    setError(null);
  }

  async function saveEdit(idx: number) {
    if (!requestId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/webhooks/manual-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          draft_id: draft.id,
          section_index: idx,
          new_body: draftBody,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(
          body.reason === "stale_draft"
            ? "This request has moved on since you opened it — refreshing to show the current version."
            : body.reason === "locked"
              ? "A decision has already been recorded — this version is locked."
              : "Couldn't save that edit. Try again."
        );
        if (body.reason === "stale_draft") setTimeout(() => router.refresh(), 1500);
        return;
      }
      setEditingIndex(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="prose-sm max-w-none">
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">{draft.title}</h1>
      <p className="text-xs text-slate-400 mb-6">
        Version {draft.version} · generated {new Date(draft.created_at).toLocaleString()}
        {draft.updated_at !== draft.created_at && (
          <> · last edited {new Date(draft.updated_at).toLocaleString()}</>
        )}
      </p>

      {draft.sections.map((section, idx) => {
        const isEditing = editingIndex === idx;
        const previous = previousByHeading.get(section.heading);
        const isNewSection = previousSections !== undefined && !previous;
        const isChangedSection = previous !== undefined && previous.body !== section.body;
        return (
          <section key={idx} className="mb-6">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-800">{section.heading}</h2>
                {isNewSection && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-accent-100 text-accent-700">
                    New
                  </span>
                )}
                {isChangedSection && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    Changed
                  </span>
                )}
              </div>
              {editable && !isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => startEditing(idx, section.body)}
                >
                  Edit
                </Button>
              )}
            </div>

            {isEditing ? (
              <div>
                {error && <p className="text-xs text-red-600 mb-1.5">{error}</p>}
                <Textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={6}
                  className="leading-relaxed"
                  autoFocus
                />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" loading={saving} onClick={() => saveEdit(idx)}>
                    {saving ? "Saving…" : "Save (creates a new version)"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={saving} onClick={cancelEditing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <MarkdownText text={section.body} />
            )}

            {isChangedSection && previous && (
              <details className="mt-2">
                <summary className="text-xs text-slate-400 cursor-pointer">
                  See previous version of this section
                </summary>
                <div className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <MarkdownText
                    text={previous.body}
                    paragraphClassName="text-sm leading-relaxed text-slate-500 mb-2 last:mb-0"
                  />
                </div>
              </details>
            )}

            {section.cited_source_ids.length > 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                Sources:{" "}
                {section.cited_source_ids
                  .map((id) => sourceById.get(id)?.title ?? id)
                  .join(", ")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-red-500">⚠ No cited source for this section.</p>
            )}
          </section>
        );
      })}
    </article>
  );
}
