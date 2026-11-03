import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { ListChecks } from "lucide-react";

export function ValidateItem({ onValidate }: { onValidate: () => void }) {
  return (
    <DropdownMenuItem onClick={onValidate} data-testid="button-open-validation">
      <ListChecks className="h-4 w-4 mr-2" />
      Validate
    </DropdownMenuItem>
  );
}
