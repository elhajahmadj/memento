import { SolutionType, type SolutionType as SolutionTypeT } from "@workspace/api-client-react";

export function SolutionTypeBadge({
  solutionType,
}: {
  solutionType?: SolutionTypeT | undefined;
}) {
  if (!solutionType) return null;
  const isApi = solutionType === SolutionType.api;
  const label = isApi ? "API" : "UI";
  return (
    <span
      data-testid={`badge-solution-type-${label.toLowerCase()}`}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        isApi
          ? "bg-primary/15 text-primary border border-primary/30"
          : "bg-muted text-muted-foreground border border-border"
      }`}
    >
      {label}
    </span>
  );
}
