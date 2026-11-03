import { describe, it, expect } from "vitest";
import {
  isStep1Valid,
  isStep2Valid,
  areParametersValid,
  isTestClassSelectionValid,
} from "../validation";
import { MAX_PARAMETERS } from "../constants";

describe("build-test domain validation", () => {
  describe("isStep1Valid", () => {
    const base = {
      urlName: "Default",
      baseUrl: "https://api.example.com",
      endpointName: "GetUsers",
      endpointPath: "/users",
    };

    it("returns true when all fields are non-empty", () => {
      expect(isStep1Valid(base)).toBe(true);
    });

    it.each(["urlName", "baseUrl", "endpointName", "endpointPath"] as const)(
      "returns false when %s is empty",
      (field) => {
        expect(isStep1Valid({ ...base, [field]: "" })).toBe(false);
      },
    );

    it.each(["urlName", "baseUrl", "endpointName", "endpointPath"] as const)(
      "returns false when %s is only whitespace",
      (field) => {
        expect(isStep1Valid({ ...base, [field]: "   " })).toBe(false);
      },
    );
  });

  describe("areParametersValid", () => {
    it("accepts an empty list", () => {
      expect(areParametersValid([])).toBe(true);
    });

    it("rejects rows with missing name or type", () => {
      expect(areParametersValid([{ name: "", type: "string" }])).toBe(false);
      expect(areParametersValid([{ name: "id", type: "" }])).toBe(false);
    });

    it("rejects more rows than MAX_PARAMETERS", () => {
      const rows = Array.from({ length: MAX_PARAMETERS + 1 }, (_, i) => ({
        name: `p${i}`,
        type: "string",
      }));
      expect(areParametersValid(rows)).toBe(false);
    });

    it("accepts exactly MAX_PARAMETERS rows", () => {
      const rows = Array.from({ length: MAX_PARAMETERS }, (_, i) => ({
        name: `p${i}`,
        type: "string",
      }));
      expect(areParametersValid(rows)).toBe(true);
    });
  });

  describe("isTestClassSelectionValid", () => {
    it("requires newClassName when mode is new", () => {
      expect(isTestClassSelectionValid("new", "UsersTests", "")).toBe(true);
      expect(isTestClassSelectionValid("new", "  ", "")).toBe(false);
    });

    it("requires existingClassPath when mode is existing", () => {
      expect(isTestClassSelectionValid("existing", "", "Tests/Foo.cs")).toBe(
        true,
      );
      expect(isTestClassSelectionValid("existing", "anything", "")).toBe(false);
    });
  });

  describe("isStep2Valid", () => {
    const base = {
      helperMethodName: "GetUsersAsync",
      testMethodName: "GetUsers_Returns200",
      parameters: [],
      testClassMode: "new" as const,
      newClassName: "UsersTests",
      existingClassPath: "",
    };

    it("returns true for valid inputs (new class)", () => {
      expect(isStep2Valid(base)).toBe(true);
    });

    it("returns false when helper method name is empty", () => {
      expect(isStep2Valid({ ...base, helperMethodName: "" })).toBe(false);
    });

    it("returns false when test method name is empty", () => {
      expect(isStep2Valid({ ...base, testMethodName: "" })).toBe(false);
    });

    it("returns false when any parameter is invalid", () => {
      expect(
        isStep2Valid({
          ...base,
          parameters: [{ name: "", type: "string" }],
        }),
      ).toBe(false);
    });

    it("returns true for valid inputs (existing class)", () => {
      expect(
        isStep2Valid({
          ...base,
          testClassMode: "existing",
          newClassName: "",
          existingClassPath: "Tests/UsersTests.cs",
        }),
      ).toBe(true);
    });

    it("returns false when existing class mode is selected but no path picked", () => {
      expect(
        isStep2Valid({
          ...base,
          testClassMode: "existing",
          existingClassPath: "",
        }),
      ).toBe(false);
    });
  });
});
