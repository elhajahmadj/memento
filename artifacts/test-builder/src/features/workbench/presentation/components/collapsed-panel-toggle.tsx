import { ChevronsRight, ChevronsLeft } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface Props {
  side: "left" | "right";
  label: string;
  testId: string;
  onClick: () => void;
}

export function CollapsedPanelToggle({ side, label, testId, onClick }: Props) {
  const Icon = side === "left" ? ChevronsRight : ChevronsLeft;
  const sideClass =
    side === "left"
      ? "left-0 rounded-l-none rounded-r-md border-l-0"
      : "right-0 rounded-r-none rounded-l-md border-r-0";
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 z-30 ${
        side === "left" ? "left-0" : "right-0"
      }`}
    >
      <Button
        size="icon"
        variant="outline"
        className={`h-12 w-6 bg-sidebar shadow-md ${sideClass}`}
        onClick={onClick}
        aria-label={label}
        data-testid={testId}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
