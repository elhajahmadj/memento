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
  isNounLanguage,
  methodNameFromNounForLanguage,
  normalizeNounForLanguage,
} from "./noun-helpers";
import { IDENT_RE, type FillPromptState, type RecordingLanguage } from "./types";

type Props = {
  prompt: FillPromptState | null;
  value: string;
  onValueChange: (v: string) => void;
  nameValue: string;
  onNameValueChange: (v: string) => void;
  language: RecordingLanguage;
  onCancel: () => void;
  onSubmit: () => void;
};

export function FillPromptDialog({
  prompt,
  value,
  onValueChange,
  nameValue,
  onNameValueChange,
  language,
  onCancel,
  onSubmit,
}: Props) {
  // Value-only mode (pre-attach browsing): nothing is recorded, so
  // there is no action to name. Everything name-related is inert.
  const nameless = prompt?.nameless === true;
  const isFillNounLang = isNounLanguage(language);
  const effectiveFillNoun = isFillNounLang
    ? normalizeNounForLanguage(nameValue, language)
    : nameValue.trim();
  const fillNameError =
    nameValue.trim() === ""
      ? null
      : isFillNounLang && !effectiveFillNoun
        ? "Name must contain at least one letter / digit / underscore once the verb prefix (and trailing Async for C#) is stripped"
        : !IDENT_RE.test(effectiveFillNoun)
          ? "Must start with a letter/underscore and contain only letters, digits, or underscores"
          : null;
  const fillNamePreview =
    isFillNounLang &&
    nameValue.trim() !== "" &&
    effectiveFillNoun &&
    IDENT_RE.test(effectiveFillNoun)
      ? methodNameFromNounForLanguage("fill", effectiveFillNoun, language)
      : null;

  const submit = () => {
    // The name field is hidden in value-only mode, so a stale error from
    // a previous prompt must not block submitting.
    if (!nameless && fillNameError) return;
    onSubmit();
  };

  return (
    <Dialog
      open={!!prompt}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-fill-prompt"
      >
        <DialogHeader>
          <DialogTitle>Fill and name this action</DialogTitle>
          <DialogDescription>
            Filling{" "}
            <code className="font-mono text-foreground">
              {prompt?.label}
            </code>{" "}
            ({prompt?.kind}) — enter the value to type and the action
            name in one step. Cancel discards both.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="recorder-fill-value"
          >
            Value to type
          </label>
          {prompt?.kind === "textarea" ? (
            <textarea
              id="recorder-fill-value"
              autoFocus
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
                // Enter inserts a newline in multi-line fields; the
                // user submits via the Fill field button or by tabbing
                // to the name input and pressing Enter there.
              }}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              placeholder="Enter text — Esc cancels"
              data-testid="input-fill-value-textarea"
            />
          ) : (
            <Input
              id="recorder-fill-value"
              autoFocus
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
              className="font-mono"
              placeholder="Enter text — Esc cancels"
              data-testid="input-fill-value"
            />
          )}
        </div>
        {/* Hidden rather than disabled in value-only mode, so the
            pre-attach prompt asks exactly one question. */}
        <div
          className={nameless ? "hidden" : "space-y-1"}
          aria-hidden={nameless}
        >
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="recorder-fill-name"
          >
            {isFillNounLang
              ? `Action name (noun — verb${language === "csharp" ? " and Async suffix are" : " is"} added automatically; leave blank to auto-name)`
              : "Action name (leave blank to auto-name)"}
          </label>
          <Input
            id="recorder-fill-name"
            value={nameValue}
            onChange={(e) => onNameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
            className="font-mono"
            placeholder={
              isFillNounLang
                ? language === "csharp"
                  ? "Noun (e.g. Username)"
                  : language === "python"
                    ? "Noun (e.g. username)"
                    : "Noun (e.g. username)"
                : "MethodName"
            }
            data-testid="input-fill-method-name"
          />
          {fillNamePreview && !fillNameError && (
            <p
              className="text-xs text-muted-foreground font-mono"
              data-testid="text-fill-name-preview"
            >
              → {fillNamePreview}()
            </p>
          )}
          {fillNameError && (
            <p
              className="text-xs text-destructive"
              data-testid="text-fill-name-error"
            >
              {fillNameError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            data-testid="button-fill-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!nameless && !!fillNameError}
            data-testid="button-fill-submit"
          >
            {nameless ? "Type into field" : "Fill field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Exposed so the parent's submit handler can short-circuit when the
 * dialog's name input is invalid — keeps validation in one place.
 */
export function computeFillNameError(
  nameValue: string,
  language: RecordingLanguage,
): string | null {
  const isFillNounLang = isNounLanguage(language);
  const effectiveFillNoun = isFillNounLang
    ? normalizeNounForLanguage(nameValue, language)
    : nameValue.trim();
  if (nameValue.trim() === "") return null;
  if (isFillNounLang && !effectiveFillNoun) {
    return "Name must contain at least one letter / digit / underscore once the verb prefix (and trailing Async for C#) is stripped";
  }
  if (!IDENT_RE.test(effectiveFillNoun)) {
    return "Must start with a letter/underscore and contain only letters, digits, or underscores";
  }
  return null;
}
