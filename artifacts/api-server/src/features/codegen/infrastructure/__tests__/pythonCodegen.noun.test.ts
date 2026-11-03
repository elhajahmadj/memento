import { describe, it, expect } from "vitest";
import type { RecordedAction } from "@/features/codegen/domain/types";

describe("normalizeNounForPython / pythonMethodNameFromNoun", () => {
  // Python's noun-flow keeps the bare snake_case noun as the canonical
  // store and decorates with `${verb}_${noun}` at render time. The
  // normalizer must accept anything the user types — PascalCase from a
  // C# muscle-memory user, mixed snake/camel, leading verb prefixes —
  // and converge on the same snake_case noun. The frontend mirror
  // `artifacts/test-builder/src/lib/python-noun.ts` MUST match this.
  it("strips a leading recognized verb when followed by an underscore", async () => {
    const { normalizeNounForPython } = await import("@/features/codegen/infrastructure/pythonCodegen");
    expect(normalizeNounForPython("click_login_button")).toBe("login_button");
    expect(normalizeNounForPython("fill_user_name")).toBe("user_name");
    expect(normalizeNounForPython("check_remember_me")).toBe("remember_me");
    expect(normalizeNounForPython("select_country")).toBe("country");
  });

  it("converts PascalCase / camelCase input to snake_case before stripping", async () => {
    const { normalizeNounForPython } = await import("@/features/codegen/infrastructure/pythonCodegen");
    expect(normalizeNounForPython("LoginButton")).toBe("login_button");
    expect(normalizeNounForPython("loginButton")).toBe("login_button");
    expect(normalizeNounForPython("ClickLoginButton")).toBe("login_button");
    expect(normalizeNounForPython("clickLoginButton")).toBe("login_button");
  });

  it("leaves a bare noun (no verb) unchanged", async () => {
    const { normalizeNounForPython } = await import("@/features/codegen/infrastructure/pythonCodegen");
    expect(normalizeNounForPython("login_button")).toBe("login_button");
    // Verb-only inputs are NOT stripped (would yield empty noun).
    expect(normalizeNounForPython("click")).toBe("click");
  });

  it("trims surrounding whitespace before normalizing", async () => {
    const { normalizeNounForPython } = await import("@/features/codegen/infrastructure/pythonCodegen");
    expect(normalizeNounForPython("  click_foo  ")).toBe("foo");
  });

  it("does NOT strip a verb prefix that runs into a non-underscore letter", async () => {
    const { normalizeNounForPython } = await import("@/features/codegen/infrastructure/pythonCodegen");
    expect(normalizeNounForPython("clickable")).toBe("clickable");
  });

  it("decorates a noun into ${verb}_${noun} per action type", async () => {
    const { pythonMethodNameFromNoun } = await import("@/features/codegen/infrastructure/pythonCodegen");
    expect(pythonMethodNameFromNoun("click", "login_button")).toBe("click_login_button");
    expect(pythonMethodNameFromNoun("fill", "user_name")).toBe("fill_user_name");
    expect(pythonMethodNameFromNoun("check", "remember_me")).toBe("check_remember_me");
    expect(pythonMethodNameFromNoun("select", "country")).toBe("select_country");
  });
});

describe("suggestedMethodNameForLastActionPython (noun-flow)", () => {
  // The legacy `suggestedMethodNameForLastAction(actions, "python")`
  // path is the C# fallback (bakes the index into the name); the new
  // language-specific entry points are what the noun-flow uses.
  it("derives ${verb}_${noun} from selector and action type", async () => {
    const { suggestedMethodNameForLastActionPython } = await import(
      "@/features/codegen/infrastructure/pythonCodegen"
    );
    const a1: RecordedAction = { type: "click", selector: '[data-testid="submit"]' };
    expect(suggestedMethodNameForLastActionPython([a1])).toBe("click_submit");
    const a2: RecordedAction = { type: "fill", selector: "#email", value: "x" };
    expect(suggestedMethodNameForLastActionPython([a1, a2])).toBe("fill_email");
  });

  it("appends `_2`/`_3` on the noun when the same verb+noun would repeat", async () => {
    const { suggestedMethodNameForLastActionPython } = await import(
      "@/features/codegen/infrastructure/pythonCodegen"
    );
    const a: RecordedAction = { type: "click", selector: '[data-testid="submit"]' };
    expect(suggestedMethodNameForLastActionPython([a, a])).toBe("click_submit_2");
    expect(suggestedMethodNameForLastActionPython([a, a, a])).toBe("click_submit_3");
  });

  it("returns null for actions without a selector (e.g. navigate)", async () => {
    const { suggestedMethodNameForLastActionPython } = await import(
      "@/features/codegen/infrastructure/pythonCodegen"
    );
    expect(
      suggestedMethodNameForLastActionPython([{ type: "navigate", url: "https://x" }]),
    ).toBeNull();
  });
});
