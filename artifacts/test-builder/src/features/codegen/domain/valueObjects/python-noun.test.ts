import { describe, it, expect } from "vitest";
import {
  normalizeNounForPython,
  pythonMethodNameFromNoun,
  pythonVerbForActionType,
} from "./python-noun";

// Parity contract for the Python noun normalizer/decorator pair shared
// between the workbench prompt UX and the api-server codegen. The
// backend has its own independent implementation in
// `artifacts/api-server/src/lib/recorder/pythonCodegen.ts` (and a
// matching test in `__tests__/codegen.test.ts → "python noun parity"`).
// When updating either side, update the other and update this test
// table to match — it is the canonical contract surface that catches
// drift.
describe("python-noun (frontend mirror of backend pythonCodegen)", () => {
  describe("normalizeNounForPython", () => {
    it("strips a leading recognized verb followed by an underscore", () => {
      expect(normalizeNounForPython("click_login_button")).toBe(
        "login_button",
      );
      expect(normalizeNounForPython("fill_user_name")).toBe("user_name");
      expect(normalizeNounForPython("check_remember_me")).toBe(
        "remember_me",
      );
      expect(normalizeNounForPython("select_country")).toBe("country");
    });

    it("converts CamelCase / camelCase input to snake_case first", () => {
      expect(normalizeNounForPython("ClickLoginButton")).toBe("login_button");
      expect(normalizeNounForPython("loginButton")).toBe("login_button");
      expect(normalizeNounForPython("LoginButton")).toBe("login_button");
    });

    it("leaves a bare snake_case noun unchanged", () => {
      expect(normalizeNounForPython("login_button")).toBe("login_button");
      expect(normalizeNounForPython("click")).toBe("click");
    });

    it("trims whitespace and collapses repeated underscores", () => {
      expect(normalizeNounForPython("  click_login_button  ")).toBe(
        "login_button",
      );
      expect(normalizeNounForPython("login__button")).toBe("login_button");
      expect(normalizeNounForPython("__login__button__")).toBe("login_button");
    });

    it("only strips one verb (the first match), not chained verbs", () => {
      expect(normalizeNounForPython("click_fill_button")).toBe("fill_button");
    });

    it("returns empty string for empty input", () => {
      expect(normalizeNounForPython("")).toBe("");
      expect(normalizeNounForPython("   ")).toBe("");
    });
  });

  describe("pythonVerbForActionType", () => {
    it("maps known action types to their Python verbs", () => {
      expect(pythonVerbForActionType("click")).toBe("click");
      expect(pythonVerbForActionType("fill")).toBe("fill");
      expect(pythonVerbForActionType("check")).toBe("check");
      expect(pythonVerbForActionType("select")).toBe("select");
    });

    it("falls back to click for unknown action types", () => {
      expect(pythonVerbForActionType("navigate")).toBe("click");
      expect(pythonVerbForActionType("assert")).toBe("click");
      expect(pythonVerbForActionType("")).toBe("click");
    });
  });

  describe("pythonMethodNameFromNoun", () => {
    it("decorates a noun into ${verb}_${noun} per action type", () => {
      expect(pythonMethodNameFromNoun("click", "login_button")).toBe(
        "click_login_button",
      );
      expect(pythonMethodNameFromNoun("fill", "user_name")).toBe(
        "fill_user_name",
      );
      expect(pythonMethodNameFromNoun("check", "remember_me")).toBe(
        "check_remember_me",
      );
      expect(pythonMethodNameFromNoun("select", "country")).toBe(
        "select_country",
      );
    });

    it("returns just the verb when the noun is empty", () => {
      expect(pythonMethodNameFromNoun("click", "")).toBe("click");
    });
  });
});
