import * as React from "react";

import { cn } from "@/shared/utils/utils";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

export interface RadioCardOption {
  value: string;
  id?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  "data-testid"?: string;
}

/**
 * Bordered-card RadioGroup pattern shared by the "Build with AI" and
 * "Start a new recording" dialogs. Each option renders as a single
 * `<label>` wrapping a `RadioGroupItem` and a label/description block;
 * options lay out one-per-row on narrow screens and side-by-side at the
 * `sm:` breakpoint.
 */
export function RadioCardGroup({
  value,
  onValueChange,
  options,
  columns = 2,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: RadioCardOption[];
  columns?: 2 | 3;
  className?: string;
}) {
  const gridCols = columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      className={cn("grid grid-cols-1 gap-1.5", gridCols, className)}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-pointer text-xs leading-tight",
            o.disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          <RadioGroupItem
            value={o.value}
            id={o.id}
            disabled={o.disabled}
            data-testid={o["data-testid"]}
          />
          {o.description ? (
            <span>
              <span className="font-medium block">{o.label}</span>
              <span className="text-muted-foreground text-[11px]">
                {o.description}
              </span>
            </span>
          ) : (
            <span className="font-medium">{o.label}</span>
          )}
        </label>
      ))}
    </RadioGroup>
  );
}
