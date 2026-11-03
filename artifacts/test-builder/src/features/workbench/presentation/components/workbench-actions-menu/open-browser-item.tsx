import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";
import { Globe } from "lucide-react";

export function OpenBrowserItem({
  onOpenBrowser,
  disabled,
  disabledReason,
}: {
  onOpenBrowser: () => void;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
}) {
  return (
    <DropdownMenuItem
      onClick={onOpenBrowser}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(disabled && disabledReason !== undefined
        ? { title: disabledReason }
        : {})}
      data-testid="button-open-browser"
    >
      <Globe className="h-4 w-4 mr-2" />
      Open Browser
    </DropdownMenuItem>
  );
}
