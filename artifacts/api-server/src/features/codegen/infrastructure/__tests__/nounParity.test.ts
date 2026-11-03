import { describe, it, expect } from "vitest";
import type { RecordedAction } from "@/features/codegen/domain/types";

// Shared-vector parity contract — keep this table in sync with the
// frontend mirrors (artifacts/test-builder/src/lib/__tests__/
// python-noun.test.ts and nodejs-noun.test.ts). Each row is a single
// shared input that BOTH the FE preview helper and the BE codegen
// helper must transform identically. Drift here means the user types a
// noun, sees one preview, and the server stores a different method
// name. The reviewer flagged two known parity bugs (FE Python collapsed
// repeated underscores while BE didn't; FE Node returned "" while BE
// returned "x" for non-identifier input) — both rows are pinned below
// to lock the alignment.
describe("FE/BE parity: shared noun vectors", () => {
  const PYTHON_VECTORS: ReadonlyArray<{ input: string; expected: string }> = [
    { input: "ClickLoginButton", expected: "login_button" },
    { input: "loginButton", expected: "login_button" },
    { input: "click_login_button", expected: "login_button" },
    { input: "login_button", expected: "login_button" },
    { input: "  click_login_button  ", expected: "login_button" },
    { input: "login__button", expected: "login_button" },
    { input: "__login__button__", expected: "login_button" },
    { input: "click_fill_button", expected: "fill_button" },
    { input: "", expected: "" },
    { input: "   ", expected: "" },
  ];

  it("Python normalizer produces the FE-mirrored output for every shared vector", async () => {
    const { normalizeNounForPython } = await import("@/features/codegen/infrastructure/pythonCodegen");
    for (const { input, expected } of PYTHON_VECTORS) {
      expect(
        normalizeNounForPython(input),
        `python vector input ${JSON.stringify(input)}`,
      ).toBe(expected);
    }
  });

  const NODEJS_VECTORS: ReadonlyArray<{ input: string; expected: string }> = [
    { input: "clickLoginButton", expected: "loginButton" },
    { input: "ClickLoginButton", expected: "loginButton" },
    { input: "click_login_button", expected: "loginButton" },
    { input: "loginButton", expected: "loginButton" },
    { input: "  clickLoginButton  ", expected: "loginButton" },
    { input: "clickable", expected: "clickable" },
    { input: "clickFillButton", expected: "fillButton" },
    { input: "", expected: "" },
    { input: "   ", expected: "" },
    { input: "---", expected: "x" },
  ];

  it("Node.js normalizer produces the FE-mirrored output for every shared vector", async () => {
    const { normalizeNounForNodejs } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    for (const { input, expected } of NODEJS_VECTORS) {
      expect(
        normalizeNounForNodejs(input),
        `nodejs vector input ${JSON.stringify(input)}`,
      ).toBe(expected);
    }
  });

  const PYTHON_DECORATE_VECTORS: ReadonlyArray<{
    type: RecordedAction["type"];
    noun: string;
    expected: string;
  }> = [
    { type: "click", noun: "login_button", expected: "click_login_button" },
    { type: "fill", noun: "user_name", expected: "fill_user_name" },
    { type: "check", noun: "remember_me", expected: "check_remember_me" },
    { type: "select", noun: "country", expected: "select_country" },
  ];

  it("pythonMethodNameFromNoun matches FE mirror for every shared vector", async () => {
    const { pythonMethodNameFromNoun } = await import("@/features/codegen/infrastructure/pythonCodegen");
    for (const { type, noun, expected } of PYTHON_DECORATE_VECTORS) {
      expect(pythonMethodNameFromNoun(type, noun)).toBe(expected);
    }
  });

  const NODEJS_DECORATE_VECTORS: ReadonlyArray<{
    type: RecordedAction["type"];
    noun: string;
    expected: string;
  }> = [
    { type: "click", noun: "loginButton", expected: "clickLoginButton" },
    { type: "fill", noun: "userName", expected: "fillUserName" },
    { type: "check", noun: "rememberMe", expected: "checkRememberMe" },
    { type: "select", noun: "country", expected: "selectCountry" },
  ];

  it("nodejsMethodNameFromNoun matches FE mirror for every shared vector", async () => {
    const { nodejsMethodNameFromNoun } = await import("@/features/codegen/infrastructure/nodejsCodegen");
    for (const { type, noun, expected } of NODEJS_DECORATE_VECTORS) {
      expect(nodejsMethodNameFromNoun(type, noun)).toBe(expected);
    }
  });
});
