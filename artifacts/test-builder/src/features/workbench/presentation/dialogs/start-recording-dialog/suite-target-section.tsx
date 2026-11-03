import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { RadioCardGroup } from "@/shared/ui/radio-card-group";
import type { RecordingMode } from "./types";

export function SuiteTargetSection({
  mode,
  setMode,
  newClassName,
  setNewClassName,
  existingPath,
  setExistingPath,
  tests,
  attachToOpenBrowser,
  isHook,
  hookLabel,
  hookLoading,
  hookHasCustomCode,
  hookCurrentBody,
  showReplayInfo,
  willReplay,
  wontReplay,
  replaySetup,
  onReplaySetupChange,
}: {
  mode: RecordingMode;
  setMode: (m: RecordingMode) => void;
  newClassName: string;
  setNewClassName: (v: string) => void;
  existingPath: string | undefined;
  setExistingPath: (v: string | undefined) => void;
  tests: Array<{ className: string; path: string }>;
  attachToOpenBrowser: boolean;
  isHook: boolean;
  hookLabel: string;
  hookLoading: boolean;
  hookHasCustomCode: boolean;
  hookCurrentBody: string;
  showReplayInfo: boolean;
  willReplay: string[];
  wontReplay: string[];
  /**
   * Whether the target class's stored setup-hook actions replay before
   * recording starts. Only surfaced when `willReplay` is non-empty —
   * there is nothing to opt out of otherwise.
   */
  replaySetup: boolean;
  onReplaySetupChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2" data-testid="section-suite-target">
      <Label className="mb-1 block text-sm">Suite target</Label>
      <RadioCardGroup
        value={mode}
        onValueChange={(v) => {
          const m = v as RecordingMode;
          setMode(m);
          // Drop any stale existing-suite selection when switching
          // to new-class mode so hook overwrite checks (and the
          // request payload) can't reference a class the user no
          // longer intends to target.
          if (m === "new") setExistingPath(undefined);
        }}
        columns={2}
        options={[
          {
            value: "new",
            id: "mode-new",
            label: "Create new test suite",
            disabled: attachToOpenBrowser,
          },
          {
            value: "existing",
            id: "mode-existing",
            label: "Add to existing test suite",
            disabled: tests.length === 0,
          },
        ]}
      />
      {mode === "new" && (
        <Input
          value={newClassName}
          onChange={(e) => setNewClassName(e.target.value)}
          placeholder="RecordedTests"
          data-testid="input-new-class"
        />
      )}
      {mode === "existing" && (
        <div className="space-y-2">
          <Select
            {...(existingPath !== undefined ? { value: existingPath } : {})}
            onValueChange={(v) => setExistingPath(v)}
          >
            <SelectTrigger data-testid="select-existing-class">
              <SelectValue placeholder="Choose suite" />
            </SelectTrigger>
            <SelectContent>
              {tests.map((t) => (
                <SelectItem key={t.path} value={t.path}>
                  {t.className}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isHook && existingPath && hookLoading && (
            <p className="text-xs text-muted-foreground">
              Checking <code>{hookLabel}</code>…
            </p>
          )}
          {isHook && hookHasCustomCode && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive space-y-2"
              data-testid="warning-hook-has-custom-code"
            >
              <div>
                <strong>Warning:</strong> <code>{hookLabel}</code> in this
                class already contains custom code. Recording will
                replace it entirely. You will be asked to confirm before
                the recording starts.
              </div>
              {hookCurrentBody && (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-destructive/80">
                    Current body
                  </div>
                  <pre
                    className="max-h-40 overflow-auto rounded border border-destructive/30 bg-background p-2 text-[11px] leading-snug text-foreground font-mono whitespace-pre"
                    data-testid="preview-hook-current-body"
                  >
                    {hookCurrentBody}
                  </pre>
                </div>
              )}
            </div>
          )}
          {isHook &&
            existingPath &&
            !hookLoading &&
            !hookHasCustomCode && (
              <p className="text-xs text-muted-foreground">
                <code>{hookLabel}</code> currently holds the default
                empty body and will be replaced by the recording.
              </p>
            )}
          {!isHook &&
            showReplayInfo &&
            (willReplay.length > 0 || wontReplay.length > 0) && (
              <div
                className="rounded-md border bg-muted/40 p-2 text-xs space-y-1"
                data-testid="replay-info"
              >
                {willReplay.length > 0 && (
                  <label
                    className="flex items-start gap-2 cursor-pointer"
                    data-testid="label-replay-setup"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={replaySetup}
                      onChange={(e) => onReplaySetupChange(e.target.checked)}
                      data-testid="checkbox-replay-setup"
                    />
                    <span>
                      <span className="font-medium">
                        Play setup before recording
                      </span>{" "}
                      — runs {willReplay.join(", ")} first, so the browser
                      starts from the post-setup state (already logged in,
                      for example) instead of the start URL. Uncheck to
                      begin at the start URL.
                    </span>
                  </label>
                )}
                {wontReplay.length > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    <span className="font-medium">Won't auto-run:</span>{" "}
                    {wontReplay.join(", ")} (hand-written or recorded
                    before this feature). Re-record the hook to enable
                    replay.
                  </p>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
