/**
 * Single discovered-test-method row in the tests tree.
 *
 * Pure presentation: a checkbox + name + kind badge. State lives on
 * the parent.
 */
import { FlaskConical } from "lucide-react";
import type { DiscoveredTestMethod } from "@workspace/api-client-react";
import { Badge } from "@/shared/ui/badge";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  KIND_BADGE_CLASS,
  KIND_LABEL,
} from "@/features/workbench/domain/tests-tree/kinds";
import { cn } from "@/shared/utils/utils";

export interface MethodRowProps {
  method: DiscoveredTestMethod;
  depth: number;
  selected: ReadonlySet<string>;
  toggleOne: (id: string, next: boolean) => void;
}

export function MethodRow({
  method,
  depth,
  selected,
  toggleOne,
}: MethodRowProps) {
  const isSelected = selected.has(method.id);
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 text-xs hover-elevate rounded-sm"
      style={{ paddingLeft: 8 + depth * 14 }}
      data-testid={`tests-tree-method-${method.id}`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={(v) => toggleOne(method.id, v === true)}
        data-testid={`tests-tree-method-checkbox-${method.id}`}
        aria-label={`Select ${method.name}`}
      />
      <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="truncate flex-1" title={method.name}>
        {method.name}
      </span>
      <Badge
        variant="outline"
        className={cn(
          "h-4 px-1.5 text-[10px] font-mono uppercase tracking-wide",
          KIND_BADGE_CLASS[method.kind],
        )}
      >
        {KIND_LABEL[method.kind]}
      </Badge>
    </div>
  );
}
