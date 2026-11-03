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
import {
  methodNameFromNounForLanguage,
  normalizeNounForLanguage,
} from "./noun-helpers";
import {
  IDENT_RE,
  type NamePromptItem,
  type RecordingLanguage,
} from "./types";

type Props = {
  prompt: NamePromptItem | null;
  nameValue: string;
  onNameValueChange: (v: string) => void;
  /** Active project language; used as the fallback when the queued
   * prompt didn't capture its own language. */
  fallbackLanguage: RecordingLanguage;
  onSkip: () => void;
  onSubmit: (chosen: string) => void;
};

export function NamePromptDialog({
  prompt,
  nameValue,
  onNameValueChange,
  fallbackLanguage,
  onSkip,
  onSubmit,
}: Props) {
  const promptLanguage = prompt?.language ?? fallbackLanguage;
  const isNounPrompt =
    !!prompt?.decoratedSuggestion &&
    (promptLanguage === "csharp" ||
      promptLanguage === "python" ||
      promptLanguage === "nodejs");
  const effectiveNoun = isNounPrompt
    ? normalizeNounForLanguage(nameValue, promptLanguage)
    : nameValue;
  const nameError = !nameValue
    ? "Name is required"
    : isNounPrompt && !effectiveNoun
      ? "Name is required"
      : !IDENT_RE.test(effectiveNoun)
        ? "Must start with a letter/underscore and contain only letters, digits, or underscores"
        : null;
  const livePreviewName =
    isNounPrompt && prompt && effectiveNoun && IDENT_RE.test(effectiveNoun)
      ? methodNameFromNounForLanguage(prompt.actionType, effectiveNoun, promptLanguage)
      : null;

  return (
    <Dialog
      open={!!prompt}
      onOpenChange={(v) => {
        if (!v) onSkip();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-name-action"
      >
        <DialogHeader>
          <DialogTitle>Name this action</DialogTitle>
          <DialogDescription>
            {isNounPrompt
              ? `This ${prompt?.actionType} becomes a method on the Actions page-object. Enter the noun (e.g. "LoginButton") — the verb${promptLanguage === "csharp" ? " and Async suffix are" : " is"} added automatically. Press Enter to accept, Esc to skip.`
              : `This ${prompt?.actionType} becomes a method on the Actions page-object. Press Enter to accept, Esc to skip and keep the suggested name.`}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={nameValue}
          onChange={(e) => onNameValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!nameError) onSubmit(nameValue);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onSkip();
            }
          }}
          className="font-mono"
          placeholder={
            isNounPrompt
              ? promptLanguage === "csharp"
                ? "Noun (e.g. LoginButton)"
                : promptLanguage === "python"
                  ? "Noun (e.g. login_button)"
                  : "Noun (e.g. loginButton)"
              : "MethodName"
          }
          data-testid="input-action-method-name"
        />
        {livePreviewName && !nameError && (
          <p
            className="text-xs text-muted-foreground font-mono"
            data-testid="text-name-action-preview"
          >
            → {livePreviewName}()
          </p>
        )}
        {nameError && (
          <p
            className="text-xs text-destructive"
            data-testid="text-name-action-error"
          >
            {nameError}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onSkip}
            data-testid="button-name-action-skip"
          >
            Skip
          </Button>
          <Button
            onClick={() => onSubmit(nameValue)}
            disabled={!!nameError}
            data-testid="button-name-action-submit"
          >
            Save name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
