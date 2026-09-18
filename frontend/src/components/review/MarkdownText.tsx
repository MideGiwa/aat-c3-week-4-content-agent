// A drafted section's body (and a channel post's content) sometimes comes
// back from the model with literal Markdown syntax — `### Subheading`,
// `**bold**`, `- bullet list` — since nothing about the JSON schema those
// come back in stops the model from writing prose that way, and
// assets/seo-best-practices.md explicitly calls for "H3 subheaders where
// needed" within a section. Before this, DraftViewer and
// ChannelAssetsPanel both rendered that text verbatim (`whitespace-pre-line`
// on a plain string), so a reviewer saw literal `**`/`#` characters instead
// of actual formatting (2026-09-18, user-reported: "the formatted view is
// what should be shown, not with ** and #").
//
// This is a small, dependency-free Markdown subset — headings (#/##/###),
// bold (**text**), italic (*text* or _text_), unordered (-/*) and ordered
// (1.) lists, paragraphs with line breaks — rather than pulling in a full
// Markdown library for the narrow, controlled set of things the pipeline's
// prompts actually ask the model to produce. It intentionally doesn't
// support links, images, code blocks, or nested lists: none of that is
// asked for anywhere in this app's generation prompts, so there was nothing
// real to test a fancier parser against.

import type { ReactNode } from "react";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${i++}`}>{match[1]}</strong>);
    } else {
      nodes.push(<em key={`${keyPrefix}-${i++}`}>{match[2] ?? match[3]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function MarkdownText({
  text,
  paragraphClassName = "text-sm leading-relaxed text-slate-700 mb-3 last:mb-0",
}: {
  text: string;
  /** Applied to each rendered paragraph — callers that previously styled a
   * single <p> (DraftViewer, ChannelAssetsPanel) pass their existing classes
   * through here so this drop-in replacement doesn't shift any spacing. */
  paragraphClassName?: string;
}) {
  const blocks = text.trim().split(/\n\s*\n/);

  return (
    <>
      {blocks.map((block, blockIdx) => {
        const lines = block
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) return null;

        const headingMatch = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
        if (headingMatch) {
          const level = headingMatch[1].length;
          const content = renderInline(headingMatch[2], `h-${blockIdx}`);
          if (level <= 2) {
            return (
              <h3 key={blockIdx} className="text-base font-semibold text-slate-800 mt-4 mb-1.5 first:mt-0">
                {content}
              </h3>
            );
          }
          return (
            <h4 key={blockIdx} className="text-sm font-semibold text-slate-800 mt-3 mb-1 first:mt-0">
              {content}
            </h4>
          );
        }

        const isBulletList = lines.every((l) => /^[-*]\s+/.test(l));
        if (isBulletList) {
          return (
            <ul key={blockIdx} className="list-disc pl-5 mb-3 space-y-1 last:mb-0">
              {lines.map((l, i) => (
                <li key={i} className="text-sm leading-relaxed text-slate-700">
                  {renderInline(l.replace(/^[-*]\s+/, ""), `b-${blockIdx}-${i}`)}
                </li>
              ))}
            </ul>
          );
        }

        const isNumberedList = lines.every((l) => /^\d+\.\s+/.test(l));
        if (isNumberedList) {
          return (
            <ol key={blockIdx} className="list-decimal pl-5 mb-3 space-y-1 last:mb-0">
              {lines.map((l, i) => (
                <li key={i} className="text-sm leading-relaxed text-slate-700">
                  {renderInline(l.replace(/^\d+\.\s+/, ""), `n-${blockIdx}-${i}`)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={blockIdx} className={paragraphClassName}>
            {lines.map((l, i) => (
              <span key={i}>
                {renderInline(l, `p-${blockIdx}-${i}`)}
                {i < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
