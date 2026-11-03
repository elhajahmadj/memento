import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import type { RecentCategory } from "./types";

export function TestCategorySection({
  isHook,
  categoryConstantName,
  setCategoryConstantName,
  categoryValue,
  setCategoryValue,
  recentCategories,
  categoryHalfFilled,
  categoryConstantNameInvalid,
}: {
  isHook: boolean;
  categoryConstantName: string;
  setCategoryConstantName: (v: string) => void;
  categoryValue: string;
  setCategoryValue: (v: string) => void;
  recentCategories: RecentCategory[];
  categoryHalfFilled: boolean;
  categoryConstantNameInvalid: boolean;
}) {
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="section-test-category"
    >
      <Label className="text-sm font-medium">Test Category (optional)</Label>
      <p className="text-xs text-muted-foreground">
        Adds a category constant for this test. Codegen writes
        {" "}
        <code>public const string &#123;ConstantName&#125; = "&#123;value&#125;"</code>
        {" "}
        into the suite's
        {" "}
        <code>TestCategories/&#123;Suite&#125;TestCategories</code>
        {" "}
        file and decorates the test with the matching category attribute.
        Both fields must be filled together — leave both blank to skip.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="category-constant-name" className="text-xs">
            Constant name (PascalCase)
          </Label>
          <Input
            id="category-constant-name"
            placeholder={
              isHook ? "Categories only apply to [Test] methods" : "Smoke"
            }
            value={isHook ? "" : categoryConstantName}
            onChange={(e) => setCategoryConstantName(e.target.value)}
            list="recent-category-constant-names"
            disabled={isHook}
            data-testid="input-category-constant-name"
          />
          <datalist id="recent-category-constant-names">
            {recentCategories.map((c) => (
              <option
                key={`name-${c.constantName}`}
                value={c.constantName}
              >
                {c.value}
              </option>
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label htmlFor="category-value" className="text-xs">
            Category value
          </Label>
          <Input
            id="category-value"
            placeholder={isHook ? "" : "smoke-tests"}
            value={isHook ? "" : categoryValue}
            onChange={(e) => setCategoryValue(e.target.value)}
            list="recent-category-values"
            disabled={isHook}
            data-testid="input-category-value"
          />
          <datalist id="recent-category-values">
            {recentCategories.map((c) => (
              <option key={`value-${c.value}`} value={c.value}>
                {c.constantName}
              </option>
            ))}
          </datalist>
        </div>
      </div>
      {isHook && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="hint-category-disabled-hook"
        >
          Categories only apply to [Test] methods, not setup hooks.
        </p>
      )}
      {categoryHalfFilled && (
        <p
          className="text-xs text-destructive"
          data-testid="error-category-half-filled"
        >
          Constant name and category value must be filled together (both
          or neither).
        </p>
      )}
      {categoryConstantNameInvalid && (
        <p
          className="text-xs text-destructive"
          data-testid="error-category-constant-name-invalid"
        >
          Constant name must be PascalCase (start with an uppercase letter,
          letters and digits only).
        </p>
      )}
    </div>
  );
}
