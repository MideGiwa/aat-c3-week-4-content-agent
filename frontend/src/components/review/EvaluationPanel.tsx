import type { Evaluation } from "@/lib/types";
import Badge from "../ui/Badge";

const STATUS_TONE: Record<Evaluation["status"], "success" | "warning" | "danger"> = {
  pass: "success",
  revise: "warning",
  reject: "danger",
};

// Threshold-based coloring on each rubric score (PRODUCTION-READINESS-UX-PLAN.md
// "Now" item 2) — mirrors how Clearscope/Surfer color their content-grading
// checklists (green/amber/red) rather than making a reviewer do the mental
// arithmetic on nine plain "7/10"s to figure out which ones actually need a
// look. Thresholds match this app's own scale (0-10): 8+ is solidly fine,
// 5-7 is worth a glance, below 5 is the ones actually worth reading closely.
function scoreColorClass(score: number): string {
  if (score >= 8) return "text-emerald-700";
  if (score >= 5) return "text-amber-700";
  return "text-red-700";
}

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
        <Badge tone={STATUS_TONE[evaluation.status]}>{evaluation.status}</Badge>
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
            <span className={`font-semibold ${scoreColorClass(s.score)}`}>{s.score}/10</span>
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
