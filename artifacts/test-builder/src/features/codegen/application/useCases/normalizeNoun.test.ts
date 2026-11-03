import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@workspace/kernel";
import { NormalizeNounUseCase } from "./normalizeNoun";

describe("NormalizeNounUseCase", () => {
  const useCase = new NormalizeNounUseCase();

  it("normalizes a C# noun and decorates the method name", () => {
    const r = useCase.execute({
      language: "csharp",
      actionType: "click",
      typedName: "ClickLoginButtonAsync",
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toEqual({
        noun: "LoginButton",
        methodName: "ClickLoginButtonAsync",
      });
    }
  });

  it("normalizes a Python noun (snake_case)", () => {
    const r = useCase.execute({
      language: "python",
      actionType: "click",
      typedName: "ClickLoginButton",
    });
    if (isOk(r)) {
      expect(r.value.noun).toBe("login_button");
      expect(r.value.methodName).toBe("click_login_button");
    } else {
      throw new Error("expected ok");
    }
  });

  it("normalizes a Node.js noun (camelCase)", () => {
    const r = useCase.execute({
      language: "nodejs",
      actionType: "fill",
      typedName: "fillUserName",
    });
    if (isOk(r)) {
      expect(r.value.noun).toBe("userName");
      expect(r.value.methodName).toBe("fillUserName");
    } else {
      throw new Error("expected ok");
    }
  });

  it("returns a validation error for non-string input", () => {
    const r = useCase.execute({
      language: "csharp",
      actionType: "click",
      // simulate a runtime caller passing the wrong type
      typedName: undefined as unknown as string,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe("validation");
    }
  });
});
