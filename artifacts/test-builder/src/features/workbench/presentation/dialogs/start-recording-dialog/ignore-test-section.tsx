import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export function IgnoreTestSection({
  ignoreEnabled,
  setIgnoreEnabled,
  ignoreReason,
  setIgnoreReason,
  recentIgnoreReasons,
  ignoreReasonMissing,
}: {
  ignoreEnabled: boolean;
  setIgnoreEnabled: (v: boolean) => void;
  ignoreReason: string;
  setIgnoreReason: (v: string) => void;
  recentIgnoreReasons: string[];
  ignoreReasonMissing: boolean;
}) {
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="section-ignore-test"
    >
      <div className="flex items-start gap-2">
        <input
          id="ignore-test"
          type="checkbox"
          className="mt-0.5"
          checked={ignoreEnabled}
          onChange={(e) => setIgnoreEnabled(e.target.checked)}
          data-testid="checkbox-ignore-test"
        />
        <div className="space-y-0.5">
          <Label htmlFor="ignore-test" className="font-normal cursor-pointer">
            Ignore this test
          </Label>
          <p className="text-xs text-muted-foreground">
            Decorates the generated test with the language-appropriate
            skip/ignore attribute (e.g. <code>[Ignore]</code> in C#) using
            the reason below. Leave unchecked for normal runs.
          </p>
        </div>
      </div>
      {ignoreEnabled && (
        <div className="space-y-1 ml-6">
          <Label htmlFor="ignore-reason" className="text-xs">
            Reason (required)
          </Label>
          <Input
            id="ignore-reason"
            placeholder="Tracked by JIRA-1234"
            value={ignoreReason}
            onChange={(e) => setIgnoreReason(e.target.value)}
            list="recent-ignore-reasons"
            data-testid="input-ignore-reason"
          />
          <datalist id="recent-ignore-reasons">
            {recentIgnoreReasons.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {ignoreReasonMissing && (
            <p
              className="text-xs text-destructive"
              data-testid="error-ignore-reason-missing"
            >
              A reason is required when "Ignore this test" is checked.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
