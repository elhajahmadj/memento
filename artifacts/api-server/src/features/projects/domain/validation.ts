import {
  validationError,
  type ValidationError,
} from "@workspace/kernel";

const VALID_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.]*$/;

/**
 * Validate the solution name slug. Accepts a leading-letter identifier
 * with letters, digits, underscores, and dots.
 */
export function validateSolutionName(name: string): ValidationError | null {
  if (!VALID_IDENTIFIER.test(name)) {
    return validationError("Invalid solution name", [
      { path: "solutionName", message: "Invalid solution name" },
    ]);
  }
  return null;
}

/**
 * Validate a C#-style namespace (dot-separated identifiers). We collapse
 * dots into a probe character so the slug regex can be reused.
 */
export function validateNamespace(ns: string): ValidationError | null {
  if (!VALID_IDENTIFIER.test(ns.replace(/\./g, "X"))) {
    return validationError("Invalid namespace", [
      { path: "namespace", message: "Invalid namespace" },
    ]);
  }
  return null;
}
