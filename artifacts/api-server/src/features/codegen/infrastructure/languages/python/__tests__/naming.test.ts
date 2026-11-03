import { describe, expect, it } from "vitest";
import {
  actionsFileRelPath,
  categoriesClassNameForSuite,
  categoriesImportModuleForSuite,
  categoriesRelPathForSuite,
  constantsClassNameForSuite,
  constantsImportModuleForSuite,
  constantsRelPathForSuite,
  escapePy,
  pyQuotedArg,
  pytestMarkerName,
  selectorsFileRelPath,
  testFileRelPath,
  toSnake,
} from "../naming";

describe("python naming helpers", () => {
  it("toSnake converts PascalCase / camelCase identifiers", () => {
    expect(toSnake("MyTestSuite")).toBe("my_test_suite");
    expect(toSnake("myTestSuite")).toBe("my_test_suite");
    expect(toSnake("HTTPParser")).toBe("http_parser");
    expect(toSnake("Already_snake")).toBe("already_snake");
  });

  it("pyQuotedArg escapes backslashes and double-quotes", () => {
    expect(pyQuotedArg("hello")).toBe('"hello"');
    expect(pyQuotedArg('a"b')).toBe('"a\\"b"');
    expect(pyQuotedArg("a\\b")).toBe('"a\\\\b"');
  });

  it("escapePy is the inner-quote version of pyQuotedArg", () => {
    expect(escapePy('a"b\\c')).toBe('a\\"b\\\\c');
  });

  it("pytestMarkerName sanitizes to a legal Python identifier", () => {
    expect(pytestMarkerName("Smoke")).toBe("Smoke");
    expect(pytestMarkerName("Regression Suite")).toBe("Regression_Suite");
    expect(pytestMarkerName("API-v2 tests")).toBe("API_v2_tests");
    expect(pytestMarkerName("2fast")).toBe("m_2fast");
    expect(pytestMarkerName("---")).toBe("category");
  });

  it("suite-scoped naming helpers stay in sync", () => {
    const suite = "Login";
    expect(constantsClassNameForSuite(suite)).toBe("LoginConstants");
    expect(constantsRelPathForSuite(suite)).toBe("constants/login_constants.py");
    expect(constantsImportModuleForSuite(suite)).toBe("constants.login_constants");
    expect(categoriesClassNameForSuite(suite)).toBe("LoginCategories");
    expect(categoriesRelPathForSuite(suite)).toBe(
      "test_categories/login_categories.py",
    );
    expect(categoriesImportModuleForSuite(suite)).toBe(
      "test_categories.login_categories",
    );
    expect(selectorsFileRelPath(suite)).toBe("pages/selectors/login_selectors.py");
    expect(actionsFileRelPath(suite)).toBe("pages/actions/login_actions.py");
    expect(testFileRelPath(suite)).toBe("tests/test_login.py");
  });
});
