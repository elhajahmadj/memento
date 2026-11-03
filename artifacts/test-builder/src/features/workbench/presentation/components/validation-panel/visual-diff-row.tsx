import type { VisualDiff } from "./types";

export function VisualDiffRow({
  runId,
  stepIndex,
  visual,
}: {
  runId: string;
  stepIndex: number;
  visual: VisualDiff;
}) {
  return (
    <div
      className={`mt-1 rounded border p-2 ${
        visual.created
          ? "border-blue-300 bg-blue-50 text-blue-900"
          : visual.ratio > visual.threshold
            ? "border-red-300 bg-red-50 text-red-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
      data-testid={`visual-${runId}-${stepIndex}`}
    >
      <div className="font-semibold">
        {visual.created
          ? `Visual baseline captured: "${visual.name}"`
          : `Visual diff for "${visual.name}": ${(
              visual.ratio * 100
            ).toFixed(2)}% (threshold ${(
              visual.threshold * 100
            ).toFixed(2)}%)`}
      </div>
      {!visual.created && visual.diffPath && (
        <a
          href={`/api/validation/runs/${encodeURIComponent(
            runId,
          )}/visual-diff?path=${encodeURIComponent(visual.diffPath)}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View overlay
        </a>
      )}
    </div>
  );
}
