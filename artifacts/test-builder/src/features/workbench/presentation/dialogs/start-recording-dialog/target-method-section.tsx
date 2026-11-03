import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Button } from "@/shared/ui/button";
import { RadioCardGroup } from "@/shared/ui/radio-card-group";
import type { RecordingTarget } from "./types";

export function TargetMethodSection({
  target,
  setTarget,
  attachToOpenBrowser,
  testsCount,
  setMode,
  isHook,
  hookLabel,
  methodName,
  setMethodName,
  resetOverwriteConsent,
  showAsyncPreview,
  finalMethodName,
  methodCollision,
  suggestedMethodName,
}: {
  target: RecordingTarget;
  setTarget: (t: RecordingTarget) => void;
  attachToOpenBrowser: boolean;
  testsCount: number;
  setMode: (m: "new" | "existing") => void;
  isHook: boolean;
  hookLabel: string;
  methodName: string;
  setMethodName: (v: string) => void;
  resetOverwriteConsent: () => void;
  showAsyncPreview: boolean;
  finalMethodName: string;
  methodCollision: boolean;
  suggestedMethodName: string;
}) {
  return (
    <div className="space-y-2" data-testid="section-target-method">
      <Label className="mb-1 block text-sm">Target method</Label>
      <RadioCardGroup
        value={target}
        onValueChange={(v) => {
          const t = v as RecordingTarget;
          setTarget(t);
          if (t !== "testMethod" && testsCount === 0) {
            setMode("new");
          }
        }}
        columns={3}
        options={[
          {
            value: "testMethod",
            id: "target-test",
            label: "New [Test] method",
          },
          {
            value: "beforeEach",
            id: "target-before",
            label: "[SetUp] BeforeEachAsync hook",
            disabled: attachToOpenBrowser,
          },
          {
            value: "oneTimeSetup",
            id: "target-onetime",
            label: "[OneTimeSetUp] OneTimeSetUpAsync hook",
            disabled: attachToOpenBrowser,
          },
        ]}
      />
      {isHook && (
        <p className="text-xs text-muted-foreground">
          The recording will replace the body of{" "}
          <code>{hookLabel}</code> in the chosen class.
        </p>
      )}
      {!isHook && (
        <div className="space-y-2">
          <Label htmlFor="method">Test method name</Label>
          <Input
            id="method"
            value={methodName}
            onChange={(e) => {
              setMethodName(e.target.value);
              resetOverwriteConsent();
            }}
            data-testid="input-method-name"
          />
          {showAsyncPreview && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="hint-method-async-preview"
            >
              Will be generated as <code>{finalMethodName}</code> (C#
              async convention).
            </p>
          )}
          {methodCollision && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive space-y-2"
              data-testid="warning-method-collision"
            >
              <div>
                <strong>Warning:</strong> a <code>[Test]</code> method
                named <code>{finalMethodName}</code> already exists in
                this class. Pick a different name or overwrite the
                existing method.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setMethodName(suggestedMethodName)}
                  data-testid="button-use-suggested-method-name"
                >
                  Use <code className="ml-1">{suggestedMethodName}</code>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
