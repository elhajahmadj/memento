import { Button } from "@/shared/ui/button";
import { Play } from "lucide-react";

export function TestMethodRow({
  className,
  filePath,
  methodName,
  onValidateMethod,
}: {
  className: string;
  filePath: string;
  methodName: string;
  // Omitted for JMX projects so the inline Validate button disappears.
  onValidateMethod?:
    | ((filePath: string, methodName: string) => void)
    | undefined;
}) {
  return (
    <div
      className="flex items-center justify-between pl-3 pr-2 py-1 hover-elevate rounded-sm"
      data-testid={`row-method-${className}-${methodName}`}
    >
      <div className="text-xs font-mono text-muted-foreground truncate">
        {methodName}
      </div>
      {onValidateMethod && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2"
          onClick={() => onValidateMethod(filePath, methodName)}
          data-testid={`button-validate-method-${className}-${methodName}`}
          title="Validate just this test method"
        >
          <Play className="h-2.5 w-2.5 mr-1 fill-current" />
          Validate
        </Button>
      )}
    </div>
  );
}
