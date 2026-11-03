import {
  useState,
  useEffect,
} from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/shared/ui/radio-group";


export function AddAssertionDialog({
  open,
  onOpenChange,
  initial,
  insertBeforeIndex,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Optional pre-filled selector + text seeded from a right-click pick
   * on the live recording canvas. When provided, the dialog opens on
   * the "element has text" kind with both fields populated so the user
   * can confirm or tweak before adding.
   */
  initial?: { selector: string; text: string } | null;
  /**
   * When provided, the new assertion is spliced into the session-array
   * BEFORE this index instead of being appended. Powers the per-row
   * "Insert step before" affordance in the actions feed.
   */
  insertBeforeIndex?: number | null;
}) {
  type Kind =
    | "element-has-text"
    | "url-contains"
    | "url-equals"
    | "element-visible"
    | "element-hidden"
    | "element-count-equals"
    | "attribute-equals"
    | "value-equals"
    | "response-status"
    | "accessibility"
    | "visual-baseline";
  const [kind, setKind] = useState<Kind>("element-has-text");
  const [selector, setSelector] = useState("");
  const [assertText, setAssertText] = useState("");
  const [assertUrl, setAssertUrl] = useState("");
  const [assertCount, setAssertCount] = useState("0");
  const [assertAttribute, setAssertAttribute] = useState("");
  const [assertAttrValue, setAssertAttrValue] = useState("");
  const [assertValue, setAssertValue] = useState("");
  const [assertStatusCode, setAssertStatusCode] = useState("200");
  const [axeImpactLevel, setAxeImpactLevel] = useState<
    "minor" | "moderate" | "serious" | "critical"
  >("serious");
  const [visualName, setVisualName] = useState("");
  const [visualThreshold, setVisualThreshold] = useState("0.05");

  useEffect(() => {
    if (!open) {
      setKind("element-has-text");
      setSelector("");
      setAssertText("");
      setAssertUrl("");
      setAssertCount("0");
      setAssertAttribute("");
      setAssertAttrValue("");
      setAssertValue("");
      setAssertStatusCode("200");
      setAxeImpactLevel("serious");
      setVisualName("");
      setVisualThreshold("0.05");
    } else if (initial) {
      // Right-click-pick path: jump straight to the element-text form
      // with the resolved selector and visible text already filled in.
      setKind("element-has-text");
      setSelector(initial.selector);
      setAssertText(initial.text);
      setAssertUrl("");
    }
  }, [open, initial]);

  const selectorRequired =
    kind === "element-has-text" ||
    kind === "element-visible" ||
    kind === "element-hidden" ||
    kind === "element-count-equals" ||
    kind === "attribute-equals" ||
    kind === "value-equals";
  const countNum = Number(assertCount);
  const statusNum = Number(assertStatusCode);
  const thresholdNum = Number(visualThreshold);
  const visualThresholdValid =
    Number.isFinite(thresholdNum) && thresholdNum >= 0 && thresholdNum <= 1;

  const canSubmit = (() => {
    if (selectorRequired && selector.trim().length === 0) return false;
    switch (kind) {
      case "element-has-text":
        return assertText.length > 0;
      case "url-contains":
      case "url-equals":
        return assertUrl.trim().length > 0;
      case "element-visible":
      case "element-hidden":
        return true;
      case "element-count-equals":
        return Number.isFinite(countNum) && countNum >= 0;
      case "attribute-equals":
        return assertAttribute.trim().length > 0;
      case "value-equals":
        return true;
      case "response-status":
        return (
          Number.isFinite(statusNum) && statusNum >= 100 && statusNum <= 599
        );
      case "accessibility":
        return true;
      case "visual-baseline":
        return visualName.trim().length > 0 && visualThresholdValid;
    }
    return false;
  })();

  const submit = () => {
    if (!canSubmit) return;
    const sel = selector.trim();
    let detail: Record<string, unknown>;
    switch (kind) {
      case "element-has-text":
        detail = { assertKind: kind, selector: sel, assertText };
        break;
      case "url-contains":
      case "url-equals":
        detail = { assertKind: kind, assertUrl: assertUrl.trim() };
        break;
      case "element-visible":
      case "element-hidden":
        detail = { assertKind: kind, selector: sel };
        break;
      case "element-count-equals":
        detail = { assertKind: kind, selector: sel, assertCount: countNum };
        break;
      case "attribute-equals":
        detail = {
          assertKind: kind,
          selector: sel,
          assertAttribute: assertAttribute.trim(),
          assertAttrValue,
        };
        break;
      case "value-equals":
        detail = { assertKind: kind, selector: sel, assertValue };
        break;
      case "response-status":
        detail = { assertKind: kind, assertStatusCode: statusNum };
        break;
      case "accessibility":
        detail = { assertKind: kind, axeImpactLevel };
        break;
      case "visual-baseline":
        detail = {
          assertKind: kind,
          visualName: visualName.trim(),
          visualThreshold: thresholdNum,
        };
        break;
      default:
        detail = { assertKind: kind };
    }
    if (typeof insertBeforeIndex === "number") {
      detail = { ...detail, insertBeforeIndex };
    }
    window.dispatchEvent(
      new CustomEvent("recorder:request-add-assertion", { detail }),
    );
    // Per-mutation undo for **mid-sequence** inserts: the new row lands
    // at the requested array index, so the inverse is a delete on
    // that index. We don't surface undo for trailing inserts because
    // the dialog doesn't know the future tail index — those rows are
    // easy to remove via the per-row trash button.
    if (typeof insertBeforeIndex === "number") {
      const insertedAt = insertBeforeIndex;
      toast.success("Assertion inserted", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            window.dispatchEvent(
              new CustomEvent("recorder:request-delete", {
                detail: { index: insertedAt },
              }),
            );
          },
        },
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-assertion">
        <DialogHeader>
          <DialogTitle>Add UI assertion</DialogTitle>
          <DialogDescription>
            Verify a piece of page state. The assertion is appended to the
            recorded actions and emitted as a Playwright Expect() call when
            the test is generated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-2">
            <Label className="text-xs">Assertion kind</Label>
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as Kind)}
              className="grid gap-1.5"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="element-has-text"
                  data-testid="radio-assert-element-has-text"
                />
                Element has text
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="element-visible"
                  data-testid="radio-assert-element-visible"
                />
                Element is visible
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="element-hidden"
                  data-testid="radio-assert-element-hidden"
                />
                Element is hidden
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="element-count-equals"
                  data-testid="radio-assert-element-count-equals"
                />
                Element count equals
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="attribute-equals"
                  data-testid="radio-assert-attribute-equals"
                />
                Attribute equals
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="value-equals"
                  data-testid="radio-assert-value-equals"
                />
                Form value equals
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="url-contains"
                  data-testid="radio-assert-url-contains"
                />
                URL contains substring
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="url-equals"
                  data-testid="radio-assert-url-equals"
                />
                URL equals exact value
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="response-status"
                  data-testid="radio-assert-response-status"
                />
                Last response status equals
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="accessibility"
                  data-testid="radio-assert-accessibility"
                />
                Accessibility (axe-core scan)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  value="visual-baseline"
                  data-testid="radio-assert-visual-baseline"
                />
                Visual regression vs. baseline
              </label>
            </RadioGroup>
          </div>
          {selectorRequired && (
            <div className="space-y-1">
              <Label htmlFor="assert-selector" className="text-xs">
                Selector (Playwright locator)
              </Label>
              <Input
                id="assert-selector"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
                placeholder="text=Welcome  or  #header"
                className="font-mono"
                data-testid="input-assert-selector"
              />
            </div>
          )}
          {kind === "element-has-text" && (
            <div className="space-y-1">
              <Label htmlFor="assert-text" className="text-xs">
                Expected text
              </Label>
              <Input
                id="assert-text"
                value={assertText}
                onChange={(e) => setAssertText(e.target.value)}
                placeholder="Hello, world"
                data-testid="input-assert-text"
              />
            </div>
          )}
          {(kind === "url-contains" || kind === "url-equals") && (
            <div className="space-y-1">
              <Label htmlFor="assert-url" className="text-xs">
                {kind === "url-contains" ? "URL substring" : "Exact URL"}
              </Label>
              <Input
                id="assert-url"
                value={assertUrl}
                onChange={(e) => setAssertUrl(e.target.value)}
                placeholder={
                  kind === "url-contains"
                    ? "/dashboard"
                    : "https://example.com/done"
                }
                className="font-mono"
                data-testid="input-assert-url"
              />
            </div>
          )}
          {kind === "element-count-equals" && (
            <div className="space-y-1">
              <Label htmlFor="assert-count" className="text-xs">
                Expected count
              </Label>
              <Input
                id="assert-count"
                type="number"
                min={0}
                value={assertCount}
                onChange={(e) => setAssertCount(e.target.value)}
                data-testid="input-assert-count"
              />
            </div>
          )}
          {kind === "attribute-equals" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="assert-attr" className="text-xs">
                  Attribute name
                </Label>
                <Input
                  id="assert-attr"
                  value={assertAttribute}
                  onChange={(e) => setAssertAttribute(e.target.value)}
                  placeholder="href"
                  className="font-mono"
                  data-testid="input-assert-attribute"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="assert-attr-value" className="text-xs">
                  Expected attribute value
                </Label>
                <Input
                  id="assert-attr-value"
                  value={assertAttrValue}
                  onChange={(e) => setAssertAttrValue(e.target.value)}
                  data-testid="input-assert-attr-value"
                />
              </div>
            </>
          )}
          {kind === "value-equals" && (
            <div className="space-y-1">
              <Label htmlFor="assert-value" className="text-xs">
                Expected form value
              </Label>
              <Input
                id="assert-value"
                value={assertValue}
                onChange={(e) => setAssertValue(e.target.value)}
                data-testid="input-assert-value"
              />
            </div>
          )}
          {kind === "response-status" && (
            <div className="space-y-1">
              <Label htmlFor="assert-status" className="text-xs">
                Expected HTTP status code
              </Label>
              <Input
                id="assert-status"
                type="number"
                min={100}
                max={599}
                value={assertStatusCode}
                onChange={(e) => setAssertStatusCode(e.target.value)}
                data-testid="input-assert-status-code"
              />
            </div>
          )}
          {kind === "accessibility" && (
            <div className="space-y-1">
              <Label className="text-xs">Minimum impact level to fail on</Label>
              <Select
                value={axeImpactLevel}
                onValueChange={(v) =>
                  setAxeImpactLevel(
                    v as "minor" | "moderate" | "serious" | "critical",
                  )
                }
              >
                <SelectTrigger data-testid="select-axe-impact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minor">minor</SelectItem>
                  <SelectItem value="moderate">moderate</SelectItem>
                  <SelectItem value="serious">serious (default)</SelectItem>
                  <SelectItem value="critical">critical</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Runs axe-core against the current page during replay and
                fails the step if any violation at this impact or above is
                found.
              </p>
            </div>
          )}
          {kind === "visual-baseline" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="visual-name" className="text-xs">
                  Baseline name
                </Label>
                <Input
                  id="visual-name"
                  value={visualName}
                  onChange={(e) => setVisualName(e.target.value)}
                  placeholder="home-page"
                  className="font-mono"
                  data-testid="input-visual-name"
                />
                <p className="text-xs text-muted-foreground">
                  First run captures the baseline; subsequent runs diff the
                  fresh screenshot against it using pixelmatch.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="visual-threshold" className="text-xs">
                  Max diff ratio (0–1)
                </Label>
                <Input
                  id="visual-threshold"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={visualThreshold}
                  onChange={(e) => setVisualThreshold(e.target.value)}
                  data-testid="input-visual-threshold"
                />
                {!visualThresholdValid && (
                  <p className="text-xs text-red-600">
                    Enter a number between 0 and 1.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-assertion-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="button-assertion-add"
          >
            Add assertion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
