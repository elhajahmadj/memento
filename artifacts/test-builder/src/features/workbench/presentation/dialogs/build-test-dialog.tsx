import { Loader2 } from "lucide-react";
import {
  useListApiBaseUrls,
  useListTestClasses,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  isStep1Valid,
  isStep2Valid,
} from "@/features/workbench/domain/build-test/validation";
import { StepEndpoint } from "./build-test-dialog/step-endpoint";
import { StepAssistant } from "./build-test-dialog/step-assistant";
import { useBuildTestForm } from "./build-test-dialog/use-build-test-form";
import { useBuildTestSubmit } from "@/features/workbench/presentation/hooks/use-build-test-submit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  solutionName: string;
}

export function BuildTestDialog({ open, onOpenChange, solutionName }: Props) {
  const f = useBuildTestForm();

  const apiBaseUrlsQuery = useListApiBaseUrls({
    query: { queryKey: ["listApiBaseUrls"], enabled: open },
  });
  const existingUrls = apiBaseUrlsQuery.data ?? [];

  const testClassesQuery = useListTestClasses({
    query: { queryKey: ["listTestClasses"], enabled: open && f.step === 2 },
  });
  const existingTestClasses = (testClassesQuery.data ?? []).filter(
    (c) =>
      c.path.includes(".Automation.API.Tests/") ||
      c.path.includes("-automation-api-tests/"),
  );

  const { submit, isPending, buildError, clearBuildError } = useBuildTestSubmit({
    solutionName,
    onSuccess: () => {
      resetAll();
      onOpenChange(false);
    },
  });

  function resetAll() {
    f.reset();
    clearBuildError();
  }

  const step1Valid = isStep1Valid(f);
  const step2Valid = isStep2Valid(f);

  function handleSubmit() {
    clearBuildError();
    submit(f);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetAll();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build API test — Step {f.step} of 2</DialogTitle>
          <DialogDescription>
            {f.step === 1
              ? "Endpoint constant + URL entry that will be merged into Constants/ApiEndpoints.cs and Tests/appsettings.json."
              : "Helper method on APITestingAssistant + the test class wiring it up with FluentAssertions."}
          </DialogDescription>
        </DialogHeader>

        {f.step === 1 && (
          <StepEndpoint form={f} existingUrls={existingUrls} />
        )}

        {f.step === 2 && (
          <StepAssistant form={f} existingTestClasses={existingTestClasses} />
        )}

        {buildError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="text-build-test-error"
          >
            {buildError}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              resetAll();
            }}
          >
            Cancel
          </Button>
          {f.step === 2 && (
            <Button
              variant="outline"
              onClick={() => f.setStep(1)}
              data-testid="button-build-test-back"
            >
              Back
            </Button>
          )}
          {f.step === 1 ? (
            <Button
              onClick={() => f.setStep(2)}
              disabled={!step1Valid}
              data-testid="button-build-test-next"
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isPending || !step2Valid}
              data-testid="button-build-test-submit"
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Build test
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
