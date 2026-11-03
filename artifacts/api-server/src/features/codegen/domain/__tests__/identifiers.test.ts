import { describe, expect, it } from "vitest";
import {
  axeAllowedImpacts,
  buildUrlEnvVarName,
  ensureAsyncSuffix,
  normalizeCsharpTestSuiteClassName,
  urlConfigPropertyName,
  urlSafe,
} from "@/features/codegen/domain/identifiers";

describe("urlSafe / buildUrlEnvVarName / urlConfigPropertyName", () => {
  it("uppercases and collapses non-alnum runs to a single underscore", () => {
    expect(urlSafe("Login")).toBe("LOGIN");
    expect(urlSafe("home page")).toBe("HOME_PAGE");
    expect(urlSafe("My.Cool-App")).toBe("MY_COOL_APP");
    expect(urlSafe("a---b___c")).toBe("A_B_C");
  });

  it("buildUrlEnvVarName produces a `<SOLUTION>_URL_<NAME>` shaped key", () => {
    expect(buildUrlEnvVarName("Acme.Foo", "login page")).toBe(
      "ACME_FOO_URL_LOGIN_PAGE",
    );
  });

  it("urlConfigPropertyName mirrors urlSafe (so derived identifiers cannot drift)", () => {
    expect(urlConfigPropertyName("home page")).toBe("HOME_PAGE");
    expect(urlConfigPropertyName("loginUrl")).toBe("LOGINURL");
  });
});

describe("normalizeCsharpTestSuiteClassName", () => {
  it("appends TestSuite when missing", () => {
    expect(normalizeCsharpTestSuiteClassName("LoginPage")).toBe(
      "LoginPageTestSuite",
    );
  });

  it("does not double-suffix names already ending with TestSuite", () => {
    expect(normalizeCsharpTestSuiteClassName("LoginPageTestSuite")).toBe(
      "LoginPageTestSuite",
    );
  });

  it("trims surrounding whitespace before suffixing", () => {
    expect(normalizeCsharpTestSuiteClassName("  LoginPage  ")).toBe(
      "LoginPageTestSuite",
    );
  });

  it("returns the empty string unchanged", () => {
    expect(normalizeCsharpTestSuiteClassName("")).toBe("");
    expect(normalizeCsharpTestSuiteClassName("   ")).toBe("");
  });
});

describe("ensureAsyncSuffix", () => {
  it("appends Async when missing", () => {
    expect(ensureAsyncSuffix("Foo")).toBe("FooAsync");
  });

  it("is idempotent", () => {
    expect(ensureAsyncSuffix("FooAsync")).toBe("FooAsync");
  });
});

describe("axeAllowedImpacts", () => {
  it("returns the floor and everything above it", () => {
    expect(axeAllowedImpacts("minor")).toEqual([
      "minor",
      "moderate",
      "serious",
      "critical",
    ]);
    expect(axeAllowedImpacts("moderate")).toEqual([
      "moderate",
      "serious",
      "critical",
    ]);
    expect(axeAllowedImpacts("serious")).toEqual(["serious", "critical"]);
    expect(axeAllowedImpacts("critical")).toEqual(["critical"]);
  });

  it("defaults to serious + critical when missing or unknown", () => {
    expect(axeAllowedImpacts(undefined)).toEqual(["serious", "critical"]);
    expect(axeAllowedImpacts("nonsense")).toEqual(["serious", "critical"]);
  });
});
