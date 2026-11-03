import { describe, it, expect } from "vitest";
import {
  normalizeNounForNodejs,
  nodejsMethodNameFromNoun,
  nodejsVerbForActionType,
} from "./nodejs-noun";

// Parity contract for the Node.js noun normalizer/decorator pair shared
// between the workbench prompt UX and the api-server codegen. The
// backend has its own independent implementation in
// `artifacts/api-server/src/lib/recorder/nodejsCodegen.ts` (and a
// matching test in `__tests__/codegen.test.ts → "nodejs noun parity"`).
// When updating either side, update the other and update this test
// table to match — it is the canonical contract surface that catches
// drift.
describe("nodejs-noun (frontend mirror of backend nodejsCodegen)", () => {
  describe("normalizeNounForNodejs", () => {
    it("strips a leading recognized verb followed by an uppercase letter", () => {
      expect(normalizeNounForNodejs("clickLoginButton")).toBe("loginButton");
      expect(normalizeNounForNodejs("fillUserName")).toBe("userName");
      expect(normalizeNounForNodejs("checkRememberMe")).toBe("rememberMe");
      expect(normalizeNounForNodejs("selectCountry")).toBe("country");
    });

    it("converts snake_case / PascalCase input to camelCase first", () => {
      expect(normalizeNounForNodejs("click_login_button")).toBe("loginButton");
      expect(normalizeNounForNodejs("ClickLoginButton")).toBe("loginButton");
      expect(normalizeNounForNodejs("LoginButton")).toBe("loginButton");
    });

    it("leaves a bare camelCase noun unchanged", () => {
      expect(normalizeNounForNodejs("loginButton")).toBe("loginButton");
    });

    it("trims surrounding whitespace before normalizing", () => {
      expect(normalizeNounForNodejs("  clickLoginButton  ")).toBe(
        "loginButton",
      );
    });

    it("does NOT strip a verb prefix that runs into a lowercase letter", () => {
      expect(normalizeNounForNodejs("clickable")).toBe("clickable");
      expect(normalizeNounForNodejs("filled")).toBe("filled");
      expect(normalizeNounForNodejs("selected")).toBe("selected");
    });

    it("only strips one verb (the first match), not chained verbs", () => {
      expect(normalizeNounForNodejs("clickFillButton")).toBe("fillButton");
    });

    it("returns empty string for empty input and 'x' for non-identifier input", () => {
      expect(normalizeNounForNodejs("")).toBe("");
      expect(normalizeNounForNodejs("   ")).toBe("");
      // Pathological input with no identifier characters falls back to
      // the literal "x" — matches the backend toCamel behavior so the
      // FE preview never disagrees with the BE-stored value.
      expect(normalizeNounForNodejs("---")).toBe("x");
    });
  });

  describe("nodejsVerbForActionType", () => {
    it("maps known action types to their Node.js verbs", () => {
      expect(nodejsVerbForActionType("click")).toBe("click");
      expect(nodejsVerbForActionType("fill")).toBe("fill");
      expect(nodejsVerbForActionType("check")).toBe("check");
      expect(nodejsVerbForActionType("select")).toBe("select");
    });

    it("falls back to click for unknown action types", () => {
      expect(nodejsVerbForActionType("navigate")).toBe("click");
      expect(nodejsVerbForActionType("assert")).toBe("click");
      expect(nodejsVerbForActionType("")).toBe("click");
    });
  });

  describe("nodejsMethodNameFromNoun", () => {
    it("decorates a noun into ${verb}${Noun} per action type", () => {
      expect(nodejsMethodNameFromNoun("click", "loginButton")).toBe(
        "clickLoginButton",
      );
      expect(nodejsMethodNameFromNoun("fill", "userName")).toBe(
        "fillUserName",
      );
      expect(nodejsMethodNameFromNoun("check", "rememberMe")).toBe(
        "checkRememberMe",
      );
      expect(nodejsMethodNameFromNoun("select", "country")).toBe(
        "selectCountry",
      );
    });

    it("returns just the verb when the noun is empty", () => {
      expect(nodejsMethodNameFromNoun("click", "")).toBe("click");
    });
  });
});
