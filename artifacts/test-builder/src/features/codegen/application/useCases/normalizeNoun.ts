/**
 * Normalize a user-typed action noun for the recorded test's target
 * language, producing the bare noun and the fully-decorated method name
 * the codegen will emit.
 *
 * This use case demonstrates the application-layer pattern for
 * test-builder:
 *   - depends only on domain value objects (no React, no fetch)
 *   - returns `Result<T, AppError>` from `@workspace/kernel`
 *   - has a single `execute()` and is comfortably under the 80-line budget
 */
import {
  err,
  ok,
  validationError,
  type AppError,
  type Result,
} from "@workspace/kernel";
import {
  csharpMethodNameFromNoun,
  normalizeNounForCsharp,
  type CSharpActionType,
} from "../../domain/valueObjects/csharp-noun";
import {
  normalizeNounForPython,
  pythonMethodNameFromNoun,
  type PythonActionType,
} from "../../domain/valueObjects/python-noun";
import {
  nodejsMethodNameFromNoun,
  normalizeNounForNodejs,
  type NodejsActionType,
} from "../../domain/valueObjects/nodejs-noun";

export type CodegenLanguage = "csharp" | "python" | "nodejs";

export interface NormalizeNounInput {
  readonly language: CodegenLanguage;
  readonly actionType: string;
  readonly typedName: string;
}

export interface NormalizedNoun {
  readonly noun: string;
  readonly methodName: string;
}

export class NormalizeNounUseCase {
  execute(input: NormalizeNounInput): Result<NormalizedNoun, AppError> {
    if (typeof input.typedName !== "string") {
      return err(validationError("typedName must be a string"));
    }
    switch (input.language) {
      case "csharp": {
        const noun = normalizeNounForCsharp(input.typedName);
        return ok({
          noun,
          methodName: csharpMethodNameFromNoun(
            input.actionType as CSharpActionType,
            noun,
          ),
        });
      }
      case "python": {
        const noun = normalizeNounForPython(input.typedName);
        return ok({
          noun,
          methodName: pythonMethodNameFromNoun(
            input.actionType as PythonActionType,
            noun,
          ),
        });
      }
      case "nodejs": {
        const noun = normalizeNounForNodejs(input.typedName);
        return ok({
          noun,
          methodName: nodejsMethodNameFromNoun(
            input.actionType as NodejsActionType,
            noun,
          ),
        });
      }
    }
  }
}
