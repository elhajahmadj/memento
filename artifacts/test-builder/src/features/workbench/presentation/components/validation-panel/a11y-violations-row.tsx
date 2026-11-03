import type { A11yViolation } from "./types";

export function A11yViolationsRow({
  runId,
  stepIndex,
  violations,
}: {
  runId: string;
  stepIndex: number;
  violations: A11yViolation[];
}) {
  return (
    <div
      className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900"
      data-testid={`a11y-${runId}-${stepIndex}`}
    >
      <div className="font-semibold mb-1">
        Accessibility violations ({violations.length})
      </div>
      <ul className="space-y-1">
        {violations.slice(0, 5).map((v) => (
          <li key={v.id}>
            <span className="uppercase text-[10px] mr-1">
              [{v.impact ?? "minor"}]
            </span>
            <span className="font-medium">{v.id}</span>
            {": "}
            <span>{v.help}</span>
            {v.nodes[0] && (
              <div className="text-muted-foreground truncate">
                {v.nodes[0].target.join(" ")}
              </div>
            )}
          </li>
        ))}
        {violations.length > 5 && (
          <li className="text-muted-foreground">
            + {violations.length - 5} more…
          </li>
        )}
      </ul>
    </div>
  );
}
