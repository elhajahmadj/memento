/**
 * Per-language registry for "API solution" scaffolding.
 *
 * Task 165 lays a foundation seam so Python / Node.js / Java API
 * solutions can be created end-to-end and reach the Build Test dialog,
 * even though their codegen is not implemented yet. C# remains the
 * fully-implemented adapter and reuses `scaffoldApiCsharp` unchanged.
 *
 * Stub adapters write a minimal on-disk layout:
 *   - the project root directory
 *   - a `.testbuilder.json` marker (`solutionType: "api"`, language)
 *   - the per-language "marker file" the workspace listing uses to
 *     classify the project (`pyproject.toml`, `package.json`,
 *     `pom.xml`)
 * That is enough for `listAvailableProjects` / `loadProject` to round
 * trip the project. Build Test for those languages will return HTTP
 * 501 from the registry in `apiTestCodegenRegistry.ts` rather than
 * silently succeeding.
 */
import type { Language } from "@/features/architectures/infrastructure/architectureService";
import {
  scaffoldApiCsharp,
  type ApiScaffoldResult,
} from "@/features/projects/infrastructure/apiCsharpScaffolder";
import { scaffoldApiPython } from "@/features/projects/infrastructure/apiPythonScaffolder";
import { scaffoldApiJava } from "@/features/projects/infrastructure/apiJavaScaffolder";
import { scaffoldApiNodejs } from "@/features/projects/infrastructure/apiNodejsScaffolder";

export const PYTHON_PROJECT_FILE = "pyproject.toml";
export const NODEJS_PROJECT_FILE = "package.json";
export const JAVA_PROJECT_FILE = "pom.xml";

export interface ApiTestScaffolder {
  readonly language: Language;
  /** True for languages with a real implementation (currently csharp). */
  readonly isImplemented: boolean;
  scaffold(
    solutionName: string,
    namespace: string,
  ): Promise<ApiScaffoldResult>;
}

const csharpScaffolder: ApiTestScaffolder = {
  language: "csharp",
  isImplemented: true,
  scaffold: (solutionName, namespace) =>
    scaffoldApiCsharp(solutionName, namespace),
};


const pythonScaffolder: ApiTestScaffolder = {
  language: "python",
  isImplemented: true,
  scaffold: (solutionName, namespace) =>
    scaffoldApiPython(solutionName, namespace),
};

const nodejsScaffolder: ApiTestScaffolder = {
  language: "nodejs",
  isImplemented: true,
  scaffold: (solutionName, namespace) =>
    scaffoldApiNodejs(solutionName, namespace),
};

const javaScaffolder: ApiTestScaffolder = {
  language: "java",
  isImplemented: true,
  scaffold: (solutionName, namespace) => scaffoldApiJava(solutionName, namespace),
};

/**
 * JMX projects do not have an "API solution" flavor — JMX is an
 * emission-only target. The stub adapter is registered so the
 * `Record<Language, …>` map stays exhaustive (and so any accidental
 * call surfaces a clear error rather than silently scaffolding nothing).
 */
const jmxScaffolder: ApiTestScaffolder = {
  language: "jmx",
  isImplemented: false,
  scaffold: () =>
    Promise.reject(
      new Error("API test scaffolding is not applicable to JMX projects"),
    ),
};

const REGISTRY: Record<Language, ApiTestScaffolder> = {
  csharp: csharpScaffolder,
  python: pythonScaffolder,
  nodejs: nodejsScaffolder,
  java: javaScaffolder,
  jmx: jmxScaffolder,
};

export function getApiTestScaffolder(language: Language): ApiTestScaffolder {
  return REGISTRY[language] ?? csharpScaffolder;
}
