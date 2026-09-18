import type { ChannelAsset } from "@/lib/types";

const CHANNEL_LABEL: Record<ChannelAsset["channel"], string> = {
  linkedin: "LinkedIn",
  x: "X",
  newsletter: "Newsletter",
};

const STATUS_STYLE: Record<ChannelAsset["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  ready_to_publish: "bg-accent-100 text-accent-700",
  published: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export default function ChannelAssetsPanel({ assets }: { assets: ChannelAsset[] }) {
  if (assets.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Channel-adapted copy hasn&apos;t been generated yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {assets.map((asset) => (
        <div key={asset.id} className="rounded-md border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {CHANNEL_LABEL[asset.channel]}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[asset.status]}`}
            >
              {asset.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-xs text-slate-600 whitespace-pre-line">{asset.content}</p>
        </div>
      ))}
    </div>
  );
}
