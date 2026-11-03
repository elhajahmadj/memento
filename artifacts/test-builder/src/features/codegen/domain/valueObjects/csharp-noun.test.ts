import { describe, it, expect } from "vitest";
import {
  csharpMethodNameFromNoun,
  csharpVerbForActionType,
  ensureAsyncSuffix,
  normalizeNounForCsharp,
} from "./csharp-noun";

// Parity contract for the C# noun normalizer/decorator pair shared
// between the workbench prompt UX and the api-server codegen. The
// backend has its own independent implementation in
// `artifacts/api-server/src/lib/recorder/codegen.ts` (and a matching
// test in `__tests__/codegen.test.ts → "normalizeNounForCsharp /
// csharpMethodNameFromNoun"`). When updating either side, update the
// other and update this test table to match — it is the canonical
// contract surface that catches drift.
describe("csharp-noun (frontend mirror of backend codegen)", () => {
  describe("normalizeNounForCsharp", () => {
    it("strips a leading recognized verb when followed by an uppercase letter", () => {
      expect(normalizeNounForCsharp("ClickLoginButton")).toBe("LoginButton");
      expect(normalizeNounForCsharp("FillUserName")).toBe("UserName");
      expect(normalizeNounForCsharp("CheckRememberMe")).toBe("RememberMe");
      expect(normalizeNounForCsharp("SelectCountry")).toBe("Country");
    });

    it("strips a trailing Async suffix", () => {
      expect(normalizeNounForCsharp("LoginButtonAsync")).toBe("LoginButton");
      expect(normalizeNounForCsharp("ClickLoginButtonAsync")).toBe(
        "LoginButton",
      );
    });

    it("leaves a bare noun (no verb, no Async) unchanged", () => {
      expect(normalizeNounForCsharp("LoginButton")).toBe("LoginButton");
      expect(normalizeNounForCsharp("Click")).toBe("Click");
      expect(normalizeNounForCsharp("Async")).toBe("Async");
    });

    it("trims surrounding whitespace before normalizing", () => {
      expect(normalizeNounForCsharp("  ClickFooAsync  ")).toBe("Foo");
    });

    it("does NOT strip a verb prefix that runs into a lowercase letter", () => {
      expect(normalizeNounForCsharp("Clickable")).toBe("Clickable");
      expect(normalizeNounForCsharp("Filled")).toBe("Filled");
      expect(normalizeNounForCsharp("Selected")).toBe("Selected");
    });

    it("only strips one verb (the first match), not chained verbs", () => {
      expect(normalizeNounForCsharp("ClickFillButton")).toBe("FillButton");
    });
  });

  describe("csharpVerbForActionType", () => {
    it("maps known action types to their C# verbs", () => {
      expect(csharpVerbForActionType("click")).toBe("Click");
      expect(csharpVerbForActionType("fill")).toBe("Fill");
      expect(csharpVerbForActionType("check")).toBe("Check");
      expect(csharpVerbForActionType("select")).toBe("Select");
    });

    it("falls back to Click for unknown action types", () => {
      expect(csharpVerbForActionType("navigate")).toBe("Click");
      expect(csharpVerbForActionType("assert")).toBe("Click");
      expect(csharpVerbForActionType("")).toBe("Click");
    });
  });

  describe("ensureAsyncSuffix", () => {
    it("appends Async to a name that does not already end in it", () => {
      expect(ensureAsyncSuffix("RecordedFlow")).toBe("RecordedFlowAsync");
      expect(ensureAsyncSuffix("Foo")).toBe("FooAsync");
    });

    it("is idempotent when the name already ends in Async", () => {
      expect(ensureAsyncSuffix("RecordedFlowAsync")).toBe("RecordedFlowAsync");
      expect(ensureAsyncSuffix("FooAsync")).toBe("FooAsync");
    });

    it("trims surrounding whitespace before suffixing", () => {
      expect(ensureAsyncSuffix("  Foo  ")).toBe("FooAsync");
      expect(ensureAsyncSuffix("  FooAsync  ")).toBe("FooAsync");
    });

    it("is a no-op when the input is exactly the suffix itself", () => {
      // The check is a plain `endsWith("Async")` — the bare token
      // `Async` already ends with the suffix, so it must round-trip
      // unchanged (idempotency contract).
      expect(ensureAsyncSuffix("Async")).toBe("Async");
    });

    it("returns an empty string for blank input", () => {
      expect(ensureAsyncSuffix("")).toBe("");
      expect(ensureAsyncSuffix("   ")).toBe("");
    });
  });

  describe("csharpMethodNameFromNoun", () => {
    it("decorates a noun into ${Verb}${Noun}Async per action type", () => {
      expect(csharpMethodNameFromNoun("click", "LoginButton")).toBe(
        "ClickLoginButtonAsync",
      );
      expect(csharpMethodNameFromNoun("fill", "UserName")).toBe(
        "FillUserNameAsync",
      );
      expect(csharpMethodNameFromNoun("check", "RememberMe")).toBe(
        "CheckRememberMeAsync",
      );
      expect(csharpMethodNameFromNoun("select", "Country")).toBe(
        "SelectCountryAsync",
      );
    });
  });
});
