import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  useGeneratePipelineFile,
  getGetProjectTreeQueryKey,
  type GeneratePipelineFileConflict,
  type PipelinePlatform,
  type PipelineMode,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Label } from "@/shared/ui/label";
import { Loader2 } from "lucide-react";

type Step = "platform" | "mode";

const PLATFORM_OPTIONS: Array<{
  value: PipelinePlatform;
  label: string;
  helper?: string;
}> = [
  { value: "github", label: "GitHub Actions" },
  {
    value: "jenkins",
    label: "Jenkins",
    helper:
      "Jenkins uses a Jenkinsfile in declarative pipeline syntax, not YAML.",
  },
  { value: "gitlab", label: "GitLab CI/CD" },
  { value: "azure", label: "Azure Pipelines" },
  { value: "circleci", label: "CircleCI" },
];

const MODE_OPTIONS: Array<{
  value: PipelineMode;
  label: string;
  helper: string;
}> = [
  {
    value: "ci",
    label: "Run tests in CI",
    helper:
      "Single-job pipeline that runs the Playwright tests directly on push and pull requests.",
  },
  {
    value: "cd",
    label: "Run tests in CD",
    helper:
      "Two-stage pipeline that publishes the project as a deployable artifact (\"drop\") and then pulls it down to run the tests.",
  },
];

export function GeneratePipelineFileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("platform");
  const [platform, setPlatform] = useState<PipelinePlatform | null>(null);
  const [mode, setMode] = useState<PipelineMode | null>(null);
  const [conflict, setConflict] = useState<{ path: string } | null>(null);

  // Reset wizard state every time the dialog closes so reopening starts
  // fresh on step 1 with no prior selection.
  useEffect(() => {
    if (!open) {
      setStep("platform");
      setPlatform(null);
      setMode(null);
      setConflict(null);
    }
  }, [open]);

  const generate = useGeneratePipelineFile({
    mutation: {
      onSuccess: async (data) => {
        toast.success(`Created ${data.path}`);
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        onOpenChange(false);
      },
      onError: async (err: unknown) => {
        const maybeConflict = parseConflict(err);
        if (maybeConflict) {
          setConflict({ path: maybeConflict.path });
          return;
        }
        toast.error(extractErrorMessage(err));
      },
    },
  });

  const isJenkins = platform === "jenkins";
  const generateLabel = isJenkins ? "Generate Jenkinsfile" : "Generate YAML";

  const submit = (overwrite: boolean) => {
    if (!platform || !mode) return;
    generate.mutate({
      data: { platform, mode, overwrite },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[480px]"
          data-testid="dialog-generate-pipeline-file"
        >
          <DialogHeader>
            <DialogTitle>Generate Pipeline File</DialogTitle>
            <DialogDescription>
              {step === "platform"
                ? "Pick a CI/CD platform. We'll generate a ready-to-use pipeline file in your project root."
                : "Pick where the Playwright tests should run."}
            </DialogDescription>
          </DialogHeader>

          {step === "platform" ? (
            <RadioGroup
              value={platform ?? ""}
              onValueChange={(v) => setPlatform(v as PipelinePlatform)}
              className="gap-3"
            >
              {PLATFORM_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-start gap-3">
                  <RadioGroupItem
                    value={opt.value}
                    id={`radio-platform-${opt.value}`}
                    data-testid={`radio-platform-${opt.value}`}
                    className="mt-1"
                  />
                  <div className="grid gap-1">
                    <Label
                      htmlFor={`radio-platform-${opt.value}`}
                      className="cursor-pointer"
                    >
                      {opt.label}
                    </Label>
                    {opt.helper && (
                      <p className="text-xs text-muted-foreground">
                        {opt.helper}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <RadioGroup
              value={mode ?? ""}
              onValueChange={(v) => setMode(v as PipelineMode)}
              className="gap-3"
            >
              {MODE_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-start gap-3">
                  <RadioGroupItem
                    value={opt.value}
                    id={`radio-mode-${opt.value}`}
                    data-testid={`radio-mode-${opt.value}`}
                    className="mt-1"
                  />
                  <div className="grid gap-1">
                    <Label
                      htmlFor={`radio-mode-${opt.value}`}
                      className="cursor-pointer"
                    >
                      {opt.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {opt.helper}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {step === "mode" && (
              <Button
                variant="ghost"
                onClick={() => setStep("platform")}
                data-testid="button-pipeline-back"
              >
                Back
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-pipeline-cancel"
            >
              Cancel
            </Button>
            {step === "platform" ? (
              <Button
                onClick={() => setStep("mode")}
                disabled={!platform}
                data-testid="button-pipeline-next"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={() => submit(false)}
                disabled={!mode || generate.isPending}
                data-testid="button-pipeline-generate"
              >
                {generate.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {generateLabel}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!conflict}
        onOpenChange={(o) => {
          if (!o) setConflict(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-pipeline-overwrite">
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite existing pipeline file?</AlertDialogTitle>
            <AlertDialogDescription>
              <code>{conflict?.path}</code> already exists in this project.
              Overwriting will replace its contents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setConflict(null)}
              data-testid="button-pipeline-overwrite-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConflict(null);
                submit(true);
              }}
              data-testid="button-pipeline-overwrite-confirm"
            >
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function parseConflict(err: unknown): GeneratePipelineFileConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const data = err.data;
  if (!data || typeof data !== "object") return null;
  const body = data as Record<string, unknown>;
  if (typeof body.path === "string" && body.exists === true) {
    return { exists: true, path: body.path };
  }
  return null;
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data;
    if (data && typeof data === "object") {
      const body = data as Record<string, unknown>;
      const fromBody =
        pickString(body.error) ??
        pickString(body.message) ??
        pickString(body.detail) ??
        pickString(body.title);
      if (fromBody) return fromBody;
    }
    if (err.status === 403) {
      return "You don't have permission to write a pipeline file to this project.";
    }
    if (err.status === 404) {
      return "No project is currently loaded.";
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Failed to generate pipeline file";
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
