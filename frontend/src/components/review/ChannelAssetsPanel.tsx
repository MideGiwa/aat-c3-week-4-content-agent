// Platform-accurate preview chrome (PRODUCTION-READINESS-UX-PLAN.md "Next"
// item 4) — before this, all three channels rendered in the same generic
// box, so a reviewer had to read the raw text and trust the platform rules
// (character limits, PAS structure, subject line) were followed rather than
// actually seeing it framed the way it'll look. This deliberately doesn't
// fabricate engagement chrome (fake like/comment counts, avatars) — just
// the structural cues (character budget, subject/body split) that actually
// help a reviewer catch a real problem.

import type { ChannelAsset } from "@/lib/types";
import Badge from "../ui/Badge";
import MarkdownText from "./MarkdownText";

const CHANNEL_LABEL: Record<ChannelAsset["channel"], string> = {
  linkedin: "LinkedIn",
  x: "X",
  newsletter: "Newsletter",
};

const STATUS_TONE: Record<ChannelAsset["status"], "neutral" | "accent" | "success" | "danger"> = {
  draft: "neutral",
  ready_to_publish: "accent",
  published: "success",
  failed: "danger",
};

// Matches generate.real.ts's own server-side validation (X content must be
// ≤280 characters) — this is a UI-only display constant, the actual
// enforcement already happens at generation time; this just shows the same
// budget back to a reviewer the way X's own composer would.
const X_CHAR_LIMIT = 280;

/** Newsletter content is generated as one plain string, with no separate
 * subject field (mock mode's template and the real prompt both just embed
 * "Subject: ..." as the first line) — this is a best-effort split for
 * preview purposes only. If the model didn't follow that convention, the
 * whole thing just renders as body text under a generic header, which is
 * still a reasonable fallback. */
function splitNewsletter(content: string): { subject: string | null; body: string } {
  const match = content.match(/^Subject:\s*(.+?)\n+([\s\S]*)$/i);
  if (!match) return { subject: null, body: content };
  return { subject: match[1].trim(), body: match[2].trim() };
}

function LinkedInPreview({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-500">
          in
        </span>
        <div>
          <p className="text-xs font-semibold text-slate-700">Your Company</p>
          <p className="text-[11px] text-slate-400">LinkedIn post preview</p>
        </div>
      </div>
      <p className="text-xs text-slate-700 whitespace-pre-line">{content}</p>
    </div>
  );
}

function XPreview({ content }: { content: string }) {
  const remaining = X_CHAR_LIMIT - content.length;
  const overLimit = remaining < 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
          𝕏
        </span>
        <div>
          <p className="text-xs font-semibold text-slate-700">@yourbrand</p>
          <p className="text-[11px] text-slate-400">X post preview</p>
        </div>
      </div>
      <p className="text-xs text-slate-700 whitespace-pre-line">{content}</p>
      <p className={`mt-2 text-right text-[11px] font-medium ${overLimit ? "text-red-600" : "text-slate-400"}`}>
        {content.length}/{X_CHAR_LIMIT}
      </p>
    </div>
  );
}

function NewsletterPreview({ content }: { content: string }) {
  const { subject, body } = splitNewsletter(content);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-500">
          ✉
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700 truncate">{subject ?? "Newsletter draft"}</p>
          <p className="text-[11px] text-slate-400">Newsletter preview</p>
        </div>
      </div>
      {/* Unlike LinkedIn/X (plain text, rendered verbatim below — those
          platforms never render Markdown), the newsletter is generated WITH
          Markdown (NEWSLETTER_MARKDOWN_RULE, generate.real.ts) since an email
          newsletter goes out through an ESP that actually renders formatting.
          This is the one channel preview that renders through MarkdownText
          instead of `whitespace-pre-line`. */}
      <MarkdownText text={body} paragraphClassName="text-xs leading-relaxed text-slate-700 mb-2 last:mb-0" />
    </div>
  );
}

export default function ChannelAssetsPanel({ assets }: { assets: ChannelAsset[] }) {
  if (assets.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Channel-adapted copy hasn&apos;t been generated yet — it&apos;s produced once a draft
        passes evaluation.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {assets.map((asset) => (
        <div key={asset.id}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {CHANNEL_LABEL[asset.channel]}
            </span>
            <Badge tone={STATUS_TONE[asset.status]}>{asset.status.replace(/_/g, " ")}</Badge>
          </div>
          {asset.channel === "linkedin" && <LinkedInPreview content={asset.content} />}
          {asset.channel === "x" && <XPreview content={asset.content} />}
          {asset.channel === "newsletter" && <NewsletterPreview content={asset.content} />}
        </div>
      ))}
    </div>
  );
}
