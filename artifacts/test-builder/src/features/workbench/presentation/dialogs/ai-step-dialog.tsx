import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { Badge } from "@/shared/ui/badge";
import { useAiAssist } from "@/shared/ai-assist/use-ai-assist";

interface StepOutput {
  verb: string;
  selector: string;
  value?: string;
  explanation: string;
}

interface AssertionOutput {
  kind: string;
  target: string;
  expected?: string;
  explanation: string;
}

/**
 * Plain-English step or assertion authoring dialog. Users type a
 * sentence like "Click the submit button"; the AI returns a
 * structured action with selector + value + explanation that the
 * user previews and confirms before insertion.
 *
 * `mode="step"` uses the step-from-text purpose; `mode="assertion"`
 * uses assertion-from-text. The caller receives the structured
 * output via `onAccept` and is responsible for inserting it into
 * the recording / assertion list.
 */
export function AiStepDialog({
  open,
  onOpenChange,
  mode,
  pageUrl,
  recentSteps,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "step" | "assertion";
  pageUrl?: string | undefined;
  recentSteps?: string[] | undefined;
  /**
   * Called with the AI's structured output when the user clicks
   * "Insert". Should return `true` if the result was actually
   * inserted (used to gate the success toast), `false` / `undefined`
   * when no insertion was possible.
   */
  onAccept?:
    | ((
        result: StepOutput | AssertionOutput,
      ) => boolean | void | undefined)
    | undefined;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<StepOutput | AssertionOutput | null>(
    null,
  );
  const stepHook = useAiAssist<
    { text: string; pageUrl?: string; recentSteps?: string[] },
    StepOutput
  >({ purpose: "step-from-text", toastOnError: false });
  const assertionHook = useAiAssist<
    { text: string; pageUrl?: string },
    AssertionOutput
  >({ purpose: "assertion-from-text", toastOnError: false });
  const active = mode === "step" ? stepHook : assertionHook;

  useEffect(() => {
    if (!open) {
      setText("");
      setPreview(null);
      stepHook.reset();
      assertionHook.reset();
    }
    // hooks are stable; we only care about `open`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const generate = async () => {
    if (!text.trim()) return;
    setPreview(null);
    const payload =
      mode === "step"
        ? {
            text: text.trim(),
            ...(pageUrl ? { pageUrl } : {}),
            ...(recentSteps ? { recentSteps } : {}),
          }
        : { text: text.trim(), ...(pageUrl ? { pageUrl } : {}) };
    // The discriminated `mode` branch ensures the right payload shape
    // is passed to the right hook; one-shot cast keeps inference happy.
    const result =
      mode === "step"
        ? await stepHook.run(
            payload as { text: string; pageUrl?: string; recentSteps?: string[] },
          )
        : await assertionHook.run(payload as { text: string; pageUrl?: string });
    if (result) setPreview(result.output);
  };

  const accept = () => {
    if (!preview) return;
    // Caller returns `true` when it actually inserted, `false` /
    // `undefined` when it couldn't (e.g. unsupported step verb). We
    // only show a success toast for real insertions so users aren't
    // misled by an empty success state.
    const inserted = onAccept?.(preview);
    if (inserted) {
      toast.success(mode === "step" ? "Step inserted." : "Assertion inserted.");
      onOpenChange(false);
    } else {
      toast.warning(
        mode === "step"
          ? "This step type can't be inserted automatically yet — open the recorder and the AI suggestion above can guide you."
          : "This assertion kind isn't supported by the recorder yet.",
      );
    }
  };

  const disabledMessage =
    active.error?.code === "disabled"
      ? active.error.message
      : null;
  const title = mode === "step" ? "Add step with AI" : "Add assertion with AI";
  const placeholder =
    mode === "step"
      ? 'e.g. "Click the submit button", "Type my test email into the email field", "Wait until the order count is 3"'
      : 'e.g. "I expect to see a success message", "The price should be greater than $10", "I should be on /checkout"';

  return (
    <Dialog open={open} onOpenChange={(v) => !active.busy && onOpenChange(v)}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid={`dialog-ai-${mode}`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {title}
            {active.lastResult?.model && (
              <Badge variant="secondary" className="text-[10px]">
                {active.lastResult.model}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Describe the {mode === "step" ? "action" : "expectation"} in plain
            English. The AI proposes a structured{" "}
            {mode === "step" ? "step" : "assertion"} you can review before
            inserting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`ai-${mode}-text`}>Description</Label>
            <Textarea
              id={`ai-${mode}-text`}
              data-testid={`input-ai-${mode}-text`}
              placeholder={placeholder}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={active.busy}
            />
          </div>

          {disabledMessage && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
              {disabledMessage}
            </div>
          )}

          {active.error && active.error.code !== "disabled" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {active.error.message}
            </div>
          )}

          {preview && (
            <div
              className="rounded border bg-muted/40 p-3 text-xs space-y-1.5 font-mono"
              data-testid={`preview-ai-${mode}`}
            >
              {mode === "step" ? (
                <>
                  <PreviewRow label="Verb" value={(preview as StepOutput).verb} />
                  <PreviewRow
                    label="Selector"
                    value={(preview as StepOutput).selector}
                  />
                  {(preview as StepOutput).value && (
                    <PreviewRow
                      label="Value"
                      value={(preview as StepOutput).value!}
                    />
                  )}
                </>
              ) : (
                <>
                  <PreviewRow
                    label="Kind"
                    value={(preview as AssertionOutput).kind}
                  />
                  <PreviewRow
                    label="Target"
                    value={(preview as AssertionOutput).target}
                  />
                  {(preview as AssertionOutput).expected && (
                    <PreviewRow
                      label="Expected"
                      value={(preview as AssertionOutput).expected!}
                    />
                  )}
                </>
              )}
              <div className="pt-1.5 font-sans text-muted-foreground italic">
                {preview.explanation}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={active.busy}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={generate}
            disabled={active.busy || !text.trim() || !!disabledMessage}
            data-testid={`button-ai-${mode}-generate`}
          >
            {active.busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            )}
            {preview ? "Try again" : "Generate"}
          </Button>
          <Button
            onClick={accept}
            disabled={!preview || active.busy}
            data-testid={`button-ai-${mode}-accept`}
          >
            Insert {mode === "step" ? "step" : "assertion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-16 shrink-0">{label}:</span>
      <span className="break-all">{value}</span>
    </div>
  );
}
