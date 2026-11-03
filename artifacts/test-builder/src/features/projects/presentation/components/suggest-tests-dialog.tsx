import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { AiAssistButton } from "@/shared/ai-assist/ai-assist-button";
import { useAiAssist } from "@/shared/ai-assist/use-ai-assist";

interface Idea {
  name: string;
  oneLineDescription: string;
  suggestedSteps: string[];
}

interface IdeasOutput {
  ideas: Idea[];
}

/**
 * "Suggest test cases from URL" AI assist dialog. Users paste a
 * landing URL (and optionally a one-line product hint); the AI
 * returns 3-7 candidate end-to-end tests with suggested steps. The
 * ideas are read-only suggestions — no project is created from them
 * here; the user copies what they want into the New Project flow.
 */
export function SuggestTestsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState("");
  const hook = useAiAssist<
    { url: string; productHint?: string },
    IdeasOutput
  >({ purpose: "test-ideas-from-url", toastOnError: false });

  const onClose = (v: boolean) => {
    if (!v) {
      setUrl("");
      setHint("");
      hook.reset();
    }
    onOpenChange(v);
  };

  const canRun = url.trim().length > 0 && !hook.busy;
  const disabledReason =
    hook.error?.code === "disabled" ? hook.error.message : undefined;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Suggest test cases from URL</DialogTitle>
          <DialogDescription>
            Paste the landing URL of the app you want to test. The AI
            will propose 3-7 candidate end-to-end test cases — happy
            paths, common error paths, and a smoke test where it makes
            sense.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="suggest-url">Landing URL</Label>
            <Input
              id="suggest-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              data-testid="input-suggest-tests-url"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="suggest-hint">
              Product hint{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="suggest-hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. invoice management SaaS for small shops"
              data-testid="input-suggest-tests-hint"
            />
          </div>
          {hook.error && hook.error.code !== "disabled" ? (
            <div
              className="text-sm text-destructive"
              data-testid="text-suggest-tests-error"
            >
              {hook.error.message}
            </div>
          ) : null}
          {hook.lastResult ? (
            <div
              className="space-y-3 pt-2 border-t"
              data-testid="list-suggest-tests-ideas"
            >
              <div className="text-sm text-muted-foreground">
                {hook.lastResult.output.ideas.length} suggested test
                {hook.lastResult.output.ideas.length === 1 ? "" : "s"}
                {hook.lastResult.model
                  ? ` — model: ${hook.lastResult.model}`
                  : ""}
              </div>
              <ul className="space-y-3">
                {hook.lastResult.output.ideas.map((idea, idx) => (
                  <li
                    key={idx}
                    className="rounded-md border p-3 bg-card"
                    data-testid={`item-suggest-tests-idea-${idx}`}
                  >
                    <div className="font-medium">{idea.name}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      {idea.oneLineDescription}
                    </div>
                    <ol className="mt-2 text-sm list-decimal list-inside space-y-0.5">
                      {idea.suggestedSteps.map((s, j) => (
                        <li key={j}>{s}</li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Close
          </Button>
          <AiAssistButton
            testId="button-suggest-tests-run"
            busy={hook.busy}
            disabled={!canRun}
            disabledReason={disabledReason}
            modelName={hook.lastResult?.model}
            onClick={() => {
              const input: { url: string; productHint?: string } = {
                url: url.trim(),
              };
              if (hint.trim()) input.productHint = hint.trim();
              void hook.run(input);
            }}
          >
            {hook.lastResult ? "Suggest again" : "Suggest tests"}
          </AiAssistButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
