import type { ValidationRunDto } from "@workspace/api-client-react";
import { PASS_RATE_WINDOW } from "@/features/tools/domain/validation-run-rules";

/**
 * Tiny inline SVG sparkline showing the most-recent N runs (newest on
 * the right). Bars are coloured by status so a quick glance reveals
 * trend direction (mostly green = healthy, alternating = flaky).
 */
export function Sparkline({ runs }: { runs: ValidationRunDto[] }) {
  const slice = runs.slice(0, PASS_RATE_WINDOW).reverse();
  const w = 96;
  const h = 18;
  const barW = w / Math.max(slice.length, 1);
  return (
    <svg
      width={w}
      height={h}
      role="img"
      aria-label="Recent run statuses"
      data-testid="sparkline-runs"
    >
      {slice.map((r, i) => {
        const colour =
          r.status === "passed"
            ? "#10b981"
            : r.status === "failed" || r.status === "error"
              ? "#ef4444"
              : r.status === "running"
                ? "#f59e0b"
                : "#94a3b8";
        return (
          <rect
            key={r.id}
            x={i * barW + 1}
            y={2}
            width={Math.max(barW - 2, 1)}
            height={h - 4}
            fill={colour}
            rx={1}
          />
        );
      })}
    </svg>
  );
}
