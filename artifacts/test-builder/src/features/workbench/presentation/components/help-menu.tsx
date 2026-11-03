import { useQueryClient } from "@tanstack/react-query";
import {
  useSetTourSeen,
  getGetTourStateQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { HelpCircle, Sparkles, ChevronDown } from "lucide-react";

/**
 * Workbench Help menu. Currently exposes a single action: "Replay
 * onboarding tour", which clears the persisted `hasSeenTour` flag for
 * the current user (so the tour also auto-launches on the home pages
 * again) and immediately re-opens the overlay via the window-level
 * `onboarding:relaunch` event the `<OnboardingTour />` component
 * listens for.
 */
export function HelpMenu() {
  const qc = useQueryClient();
  const setSeen = useSetTourSeen({
    mutation: {
      onSettled: async () => {
        await qc.invalidateQueries({ queryKey: getGetTourStateQueryKey() });
      },
    },
  });

  const replayTour = () => {
    setSeen.mutate({ data: { hasSeenTour: false } });
    window.dispatchEvent(new CustomEvent("onboarding:relaunch"));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          data-testid="button-help-menu"
          aria-label="Help"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Help</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onClick={replayTour}
          data-testid="menu-item-replay-tour"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Replay onboarding tour
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
