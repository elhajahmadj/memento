import { MAX_PARAMETERS } from "./constants";
import type { ParamRow, TestClassMode } from "./types";

export interface Step1Input {
  urlName: string;
  baseUrl: string;
  endpointName: string;
  endpointPath: string;
}

export interface Step2Input {
  helperMethodName: string;
  testMethodName: string;
  parameters: ParamRow[];
  testClassMode: TestClassMode;
  newClassName: string;
  existingClassPath: string;
}

export function isStep1Valid(s: Step1Input): boolean {
  return (
    s.urlName.trim() !== "" &&
    s.baseUrl.trim() !== "" &&
    s.endpointName.trim() !== "" &&
    s.endpointPath.trim() !== ""
  );
}

export function areParametersValid(parameters: ParamRow[]): boolean {
  if (parameters.length > MAX_PARAMETERS) return false;
  return parameters.every(
    (p) => p.name.trim() !== "" && p.type.trim() !== "",
  );
}

export function isTestClassSelectionValid(
  mode: TestClassMode,
  newClassName: string,
  existingClassPath: string,
): boolean {
  return mode === "new"
    ? newClassName.trim() !== ""
    : existingClassPath.trim() !== "";
}

export function isStep2Valid(s: Step2Input): boolean {
  return (
    s.helperMethodName.trim() !== "" &&
    s.testMethodName.trim() !== "" &&
    areParametersValid(s.parameters) &&
    isTestClassSelectionValid(s.testClassMode, s.newClassName, s.existingClassPath)
  );
}
