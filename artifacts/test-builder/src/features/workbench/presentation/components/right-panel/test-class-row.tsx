import { Button } from "@/shared/ui/button";
import { Play, Plus } from "lucide-react";
import { TestMethodRow } from "./test-method-row";

export function TestClassRow({
  className,
  filePath,
  methods,
  onAddMethod,
  onValidateClass,
  onValidateMethod,
}: {
  className: string;
  filePath: string;
  methods: string[];
  onAddMethod: (filePath: string) => void;
  // Omitted for JMX projects so the inline Validate buttons disappear.
  onValidateClass?: ((filePath: string) => void) | undefined;
  onValidateMethod?:
    | ((filePath: string, methodName: string) => void)
    | undefined;
}) {
  return (
    <div className="rounded-sm">
      <div className="flex items-center justify-between px-2 py-1.5 hover-elevate rounded-sm">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{className}</div>
        </div>
        <div className="flex items-center gap-1">
          {onValidateClass && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onValidateClass(filePath)}
              data-testid={`button-validate-class-${className}`}
              title="Validate this test class"
            >
              <Play className="h-3 w-3 mr-1 fill-current" />
              Validate
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onAddMethod(filePath)}
            data-testid={`button-add-method-${className}`}
          >
            <Plus className="h-3 w-3 mr-1" />
            Method
          </Button>
        </div>
      </div>
      {methods.length > 0 && (
        <div
          className="ml-3 border-l border-sidebar-border"
          data-testid={`methods-list-${className}`}
        >
          {methods.map((m) => (
            <TestMethodRow
              key={m}
              className={className}
              filePath={filePath}
              methodName={m}
              onValidateMethod={onValidateMethod}
            />
          ))}
        </div>
      )}
    </div>
  );
}
