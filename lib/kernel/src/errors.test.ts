import { describe, expect, it } from "vitest";
import {
  conflictError,
  forbiddenError,
  httpStatusForAppError,
  infrastructureError,
  notFoundError,
  unauthorizedError,
  unknownError,
  validationError,
} from "./errors";

describe("AppError constructors", () => {
  it("validationError carries details", () => {
    const e = validationError("bad", [{ path: "x", message: "required" }]);
    expect(e.kind).toBe("validation");
    expect(e.details?.[0]).toEqual({ path: "x", message: "required" });
  });

  it("notFoundError defaults message to '<resource> not found'", () => {
    expect(notFoundError("Project", "abc").message).toBe("Project not found");
  });
});

describe("httpStatusForAppError", () => {
  it.each([
    [validationError("v"), 400],
    [unauthorizedError(), 401],
    [forbiddenError(), 403],
    [notFoundError("R"), 404],
    [conflictError("c"), 409],
    [infrastructureError("i"), 502],
    [unknownError(), 500],
  ])("maps %j -> %i", (input, expected) => {
    expect(httpStatusForAppError(input)).toBe(expected);
  });
});
