/**
 * Per-language registry for "API test build" codegen.
 *
 * Task 165 keeps C# fully implemented and adds typed stub adapters for
 * Python / Node.js / Java that throw `ApiTestNotImplementedError`. The
 * route handler translates that error into HTTP 501 so the Build Test
 * dialog can surface a clear "not implemented yet" message instead of
 * the previous generic 400.
 */
import type { Language } from "@/features/architectures/infrastructure/architectureService";
import {
  planApiTestBuild,
  commitApiTestPlan,
  type BuildApiTestSpec,
} from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  planApiTestBuild as planApiTestBuildPython,
  commitApiTestPlan as commitApiTestPlanPython,
} from "@/features/codegen/infrastructure/apiPythonCodegen";
import { planApiTestBuildJava } from "@/features/codegen/infrastructure/apiJavaCodegen";
import { planApiTestBuild as planApiTestBuildNodejs } from "@/features/codegen/infrastructure/apiNodejsCodegen";

export interface ApiTestPlanInput {
  rootPath: string;
  solutionName: string;
  namespace: string;
}

export interface ApiTestBuildResult {
  files: Array<{ relPath: string; created: boolean }>;
}

export class ApiTestNotImplementedError extends Error {
  constructor(public readonly language: Language) {
    super(`API test build for ${language} is not implemented yet`);
    this.name = "ApiTestNotImplementedError";
  }
}

export interface ApiTestCodegen {
  readonly language: Language;
  readonly isImplemented: boolean;
  planAndCommit(
    project: ApiTestPlanInput,
    spec: BuildApiTestSpec,
  ): Promise<ApiTestBuildResult>;
}

const csharpCodegen: ApiTestCodegen = {
  language: "csharp",
  isImplemented: true,
  async planAndCommit(project, spec) {
    const plan = await planApiTestBuild(project, spec);
    await commitApiTestPlan(plan);
    return {
      files: plan.files.map((f) => ({
        relPath: f.relPath,
        created: f.created,
      })),
    };
  },
};

const pythonCodegen: ApiTestCodegen = {
  language: "python",
  isImplemented: true,
  async planAndCommit(project, spec) {
    const plan = await planApiTestBuildPython(project, spec);
    await commitApiTestPlanPython(plan);
    return {
      files: plan.files.map((f) => ({
        relPath: f.relPath,
        created: f.created,
      })),
    };
  },
};

const javaCodegen: ApiTestCodegen = {
  language: "java",
  isImplemented: true,
  async planAndCommit(project, spec) {
    const plan = await planApiTestBuildJava(project, spec);
    await commitApiTestPlan(plan);
    return {
      files: plan.files.map((f) => ({
        relPath: f.relPath,
        created: f.created,
      })),
    };
  },
};

const nodejsCodegen: ApiTestCodegen = {
  language: "nodejs",
  isImplemented: true,
  async planAndCommit(project, spec) {
    const plan = await planApiTestBuildNodejs(project, spec);
    await commitApiTestPlan(plan);
    return {
      files: plan.files.map((f) => ({
        relPath: f.relPath,
        created: f.created,
      })),
    };
  },
};

/**
 * JMX projects have no "API test build" flow — JMX is an emission-only
 * target driven by the captured HTTP recorder. The stub keeps the
 * `Record<Language, …>` exhaustive and surfaces a clear 501 via
 * `ApiTestNotImplementedError` if anything ever routes here.
 */
const jmxCodegen: ApiTestCodegen = {
  language: "jmx",
  isImplemented: false,
  planAndCommit: () =>
    Promise.reject(new ApiTestNotImplementedError("jmx")),
};

const REGISTRY: Record<Language, ApiTestCodegen> = {
  csharp: csharpCodegen,
  python: pythonCodegen,
  nodejs: nodejsCodegen,
  java: javaCodegen,
  jmx: jmxCodegen,
};

export function getApiTestCodegen(language: Language): ApiTestCodegen {
  return REGISTRY[language] ?? csharpCodegen;
}
