import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Play } from "lucide-react";
import type { RecordedRecordingDto } from "@workspace/api-client-react";
import { recordingLabel } from "./helpers";

export function RecordingListItem({
  recording,
  isAnyRunActive,
  onValidate,
}: {
  recording: RecordedRecordingDto;
  isAnyRunActive: boolean;
  onValidate: (r: RecordedRecordingDto) => void;
}) {
  const r = recording;
  const testIdSuffix =
    r.source === "session" ? "session" : `${r.kind}-${r.methodName ?? "hook"}`;
  return (
    <li
      className="p-2 flex items-center gap-2"
      data-testid={`row-recording-${testIdSuffix}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-2">
          <span className="truncate">{recordingLabel(r)}</span>
          {r.unsaved && (
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wide border-amber-500 text-amber-700"
              data-testid="badge-unsaved"
            >
              unsaved
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {r.startUrl} ({r.urlName})
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onValidate(r)}
        disabled={isAnyRunActive}
        data-testid={`button-validate-${testIdSuffix}`}
      >
        <Play className="h-3 w-3 mr-1 fill-current" />
        Validate
      </Button>
    </li>
  );
}
