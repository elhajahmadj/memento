import { describe, it, expect } from "vitest";
import {
  ApiTestNotImplementedError,
  getApiTestCodegen,
  type ApiTestPlanInput,
} from "@/features/codegen/infrastructure/apiTestCodegenRegistry";
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";

const PROJECT: ApiTestPlanInput = {
  rootPath: "/tmp/does-not-matter",
  solutionName: "Sample",
  namespace: "Sample",
};

const SPEC: BuildApiTestSpec = {
  baseUrl: "https://api.example.com",
  urlName: "Default",
  endpointName: "GetUsers",
  endpointSection: null,
  endpointPath: "/users",
  buildInto: "testMethod",
  testMethodName: "GetUsers_Returns200",
  testClass: { mode: "new", className: "UsersTests" },
  helperMethodName: "GetUsersAsync",
  parameters: [],
  httpMethod: "GET",
  useAccessToken: false,
  multipartFields: [],
  defaultHeaders: [],
};

describe("getApiTestCodegen", () => {
  it.each(["csharp", "python", "nodejs", "java"] as const)(
    "returns an implemented adapter for %s",
    (lang) => {
      expect(getApiTestCodegen(lang).isImplemented).toBe(true);
    },
  );

  it.each([] as Array<never>)(
    "returns a stub adapter for %s",
    (lang) => {
      expect(getApiTestCodegen(lang).isImplemented).toBe(false);
    },
  );

  it.each([] as Array<never>)(
    "stub adapter for %s rejects with ApiTestNotImplementedError carrying the language",
    async (lang) => {
      const codegen = getApiTestCodegen(lang);
      await expect(codegen.planAndCommit(PROJECT, SPEC)).rejects.toBeInstanceOf(
        ApiTestNotImplementedError,
      );
      try {
        await codegen.planAndCommit(PROJECT, SPEC);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiTestNotImplementedError);
        expect((e as ApiTestNotImplementedError).language).toBe(lang);
        expect((e as Error).message).toBe(
          `API test build for ${lang} is not implemented yet`,
        );
      }
    },
  );
});
