import { Label } from "@/shared/ui/label";

export function KeepBrowserOpenSection({
  keepBrowserOpen,
  setKeepBrowserOpen,
}: {
  keepBrowserOpen: boolean;
  setKeepBrowserOpen: (v: boolean) => void;
}) {
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="section-keep-browser-open"
    >
      <div className="flex items-start gap-2">
        <input
          id="keep-browser-open"
          type="checkbox"
          className="mt-0.5"
          checked={keepBrowserOpen}
          onChange={(e) => setKeepBrowserOpen(e.target.checked)}
          data-testid="checkbox-keep-browser-open"
        />
        <div className="space-y-0.5">
          <Label
            htmlFor="keep-browser-open"
            className="font-normal cursor-pointer"
          >
            Keep browser open after stop recording button is clicked
          </Label>
          <p className="text-xs text-muted-foreground">
            When checked, clicking Stop Recording leaves the browser
            running. Saving finalizes the test as usual, then the same
            browser stays open so your next recording can attach to it
            and add another [Test] into the same suite without
            relaunching.
          </p>
        </div>
      </div>
    </div>
  );
}
