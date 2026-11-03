import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";

export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  testId,
  headerBadge,
  children,
}: {
  title: string;
  description?: string | undefined;
  defaultOpen?: boolean | undefined;
  testId?: string | undefined;
  headerBadge?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className="rounded-lg border border-border bg-card shadow-card"
        data-testid={testId ? `settings-section-${testId}` : undefined}
      >
        <CollapsibleTrigger
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover-elevate active-elevate-2 rounded-t-lg data-[state=closed]:rounded-b-lg"
          data-testid={testId ? `collapsible-trigger-${testId}` : undefined}
        >
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <span>{title}</span>
              {headerBadge}
            </h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">
                {description}
              </p>
            )}
          </div>
          <ChevronDown
            className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent forceMount asChild>
          <div
            className="border-t border-border px-5 py-5 data-[state=closed]:hidden"
            data-state={open ? "open" : "closed"}
          >
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
