import type { Evaluation } from "@/lib/types";

const STATUS_STYLE: Record<Evaluation["status"], string> = {
  pass: "bg-emerald-100 text-emerald-800",
  revise: "bg-amber-100 text-amber-800",
  reject: "bg-red-100 text-red-800",
};

export default function EvaluationPanel({ evaluation }: { evaluation: Evaluation | undefined }) {
  if (!evaluation) {
    return (
      <div className="text-xs text-slate-400">No evaluation recorded for this version yet.</div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Evaluation — round {evaluation.round}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[evaluation.status]}`}>
          {evaluation.status}
        </span>
      </div>

      <ul className="space-y-1.5 mb-3">
        {evaluation.scores.map((s) => (
          <li key={s.criterion} className="flex items-center justify-between text-xs">
            <span className="text-slate-600">
              {s.criterion}
              {s.scope === "custom" && (
                <span className="ml-1 text-accent-600" title="Custom criterion, added beyond the default rubric">
                  ★
                </span>
              )}
            </span>
            <span className="font-medium text-slate-800">{s.score}/10</span>
          </li>
        ))}
      </ul>

      {evaluation.unsupported_claims.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-red-700 mb-1">Unsupported claims</p>
          <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
            {evaluation.unsupported_claims.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.sections_needing_revision.length > 0 && (
        <div>
          <p className="text-xs font-medium text-amber-700 mb-1">Sections needing revision</p>
          <ul className="text-xs text-amber-600 list-disc list-inside space-y-0.5">
            {evaluation.sections_needing_revision.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
