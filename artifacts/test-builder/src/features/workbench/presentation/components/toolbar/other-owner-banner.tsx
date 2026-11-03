import { Button } from "@/shared/ui/button";
import { Loader2, Trash2 } from "lucide-react";

export function OtherOwnerBanner({
  ownerUsername,
  ownerProjectName,
  isPending,
  onForceDiscard,
}: {
  ownerUsername?: string | null | undefined;
  ownerProjectName?: string | null | undefined;
  isPending: boolean;
  onForceDiscard: () => void;
}) {
  const label = ownerUsername ?? "another user";
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300"
      data-testid="banner-recording-owned-by-other"
    >
      <span data-testid="text-recording-other-owner">
        Recording in progress by{" "}
        <span className="font-semibold">{label}</span>
        {ownerProjectName ? (
          <>
            {" "}on <span className="font-semibold">{ownerProjectName}</span>
          </>
        ) : null}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={onForceDiscard}
        disabled={isPending}
        data-testid="button-force-discard-recording"
        title="Discard the global recording session so you (or someone else) can record"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <Trash2 className="h-3 w-3 mr-1" />
        )}
        Force discard
      </Button>
    </div>
  );
}
