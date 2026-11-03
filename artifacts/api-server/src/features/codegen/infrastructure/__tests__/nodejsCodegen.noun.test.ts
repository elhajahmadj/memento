import { describe, it, expect } from "vitest";
import type { RecordedAction } from "@/features/codegen/domain/types";

describe("normalizeNounForNodejs / nodejsMethodNameFromNoun", () => {
  // Node.js's noun-flow stores a camelCase noun and decorates with
  // `${verb}${Noun}` at render time. Same broad-tolerance contract as
  // the Python helper. The frontend mirror
  // `artifacts/test-builder/src/lib/nodejs-noun.ts` MUST match this.
  it("strips a leading recognized verb when followed by an uppercase letter", async () => {
    const { normalizeNounForNodejs } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    expect(normalizeNounForNodejs("clickLoginButton")).toBe("loginButton");
    expect(normalizeNounForNodejs("fillUserName")).toBe("userName");
    expect(normalizeNounForNodejs("checkRememberMe")).toBe("rememberMe");
    expect(normalizeNounForNodejs("selectCountry")).toBe("country");
  });

  it("converts PascalCase / snake_case input to camelCase before stripping", async () => {
    const { normalizeNounForNodejs } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    expect(normalizeNounForNodejs("LoginButton")).toBe("loginButton");
    expect(normalizeNounForNodejs("login_button")).toBe("loginButton");
    expect(normalizeNounForNodejs("ClickLoginButton")).toBe("loginButton");
    expect(normalizeNounForNodejs("click_login_button")).toBe("loginButton");
  });

  it("leaves a bare noun (no verb) unchanged", async () => {
    const { normalizeNounForNodejs } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    expect(normalizeNounForNodejs("loginButton")).toBe("loginButton");
    expect(normalizeNounForNodejs("click")).toBe("click");
  });

  it("trims surrounding whitespace before normalizing", async () => {
    const { normalizeNounForNodejs } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    expect(normalizeNounForNodejs("  clickFoo  ")).toBe("foo");
  });

  it("does NOT strip a verb prefix that runs into a lowercase letter", async () => {
    const { normalizeNounForNodejs } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    expect(normalizeNounForNodejs("clickable")).toBe("clickable");
  });

  it("decorates a noun into ${verb}${Noun} per action type", async () => {
    const { nodejsMethodNameFromNoun } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    expect(nodejsMethodNameFromNoun("click", "loginButton")).toBe("clickLoginButton");
    expect(nodejsMethodNameFromNoun("fill", "userName")).toBe("fillUserName");
    expect(nodejsMethodNameFromNoun("check", "rememberMe")).toBe("checkRememberMe");
    expect(nodejsMethodNameFromNoun("select", "country")).toBe("selectCountry");
  });
});

describe("suggestedMethodNameForLastActionNodejs (noun-flow)", () => {
  it("derives ${verb}${Noun} from selector and action type", async () => {
    const { suggestedMethodNameForLastActionNodejs } = await import(
      "@/features/codegen/infrastructure/nodejsCodegen"
    );
    const a1: RecordedAction = { type: "click", selector: '[data-testid="submit"]' };
    expect(suggestedMethodNameForLastActionNodejs([a1])).toBe("clickSubmit");
    const a2: RecordedAction = { type: "fill", selector: "#email", value: "x" };
    expect(suggestedMethodNameForLastActionNodejs([a1, a2])).toBe("fillEmail");
  });

  it("appends a bare `2`/`3` on the noun when the same verb+noun would repeat", async () => {
    const { suggestedMethodNameForLastActionNodejs } = await import(
      "@/features/codegen/infrastructure/nodejsCodegen"
    );
    const a: RecordedAction = { type: "click", selector: '[data-testid="submit"]' };
    expect(suggestedMethodNameForLastActionNodejs([a, a])).toBe("clickSubmit2");
    expect(suggestedMethodNameForLastActionNodejs([a, a, a])).toBe("clickSubmit3");
  });

  it("returns null for actions without a selector (e.g. navigate)", async () => {
    const { suggestedMethodNameForLastActionNodejs } = await import(
      "@/features/codegen/infrastructure/nodejsCodegen"
    );
    expect(
      suggestedMethodNameForLastActionNodejs([{ type: "navigate", url: "https://x" }]),
    ).toBeNull();
  });
});
