/**
 * Built-in API "default" marker architectures (one per language).
 *
 * Their `projects: []` array is empty on purpose: scaffolding is
 * delegated to the per-language API scaffolder in
 * `apiTestScaffolderRegistry`. They exist so the New Project dialog has
 * a default option to show alongside any custom API architectures.
 */
import {
  type Architecture,
  type Language,
  API_DEFAULT_CSHARP_ARCHITECTURE_ID,
  API_DEFAULT_JAVA_ARCHITECTURE_ID,
  API_DEFAULT_NODEJS_ARCHITECTURE_ID,
  API_DEFAULT_PYTHON_ARCHITECTURE_ID,
} from "../types";

function buildBuiltInApiArchitecture(
  id: string,
  name: string,
  language: Language,
): Architecture {
  return {
    id,
    name,
    isBuiltIn: true,
    language,
    solutionType: "api",
    projects: [],
  };
}

export const API_DEFAULT_CSHARP_ARCHITECTURE = buildBuiltInApiArchitecture(
  API_DEFAULT_CSHARP_ARCHITECTURE_ID,
  "API Default (C# / xUnit + HttpClient)",
  "csharp",
);
export const API_DEFAULT_PYTHON_ARCHITECTURE = buildBuiltInApiArchitecture(
  API_DEFAULT_PYTHON_ARCHITECTURE_ID,
  "API Default (Python / pytest + httpx)",
  "python",
);
export const API_DEFAULT_NODEJS_ARCHITECTURE = buildBuiltInApiArchitecture(
  API_DEFAULT_NODEJS_ARCHITECTURE_ID,
  "API Default (Node.js / Vitest + undici)",
  "nodejs",
);
export const API_DEFAULT_JAVA_ARCHITECTURE = buildBuiltInApiArchitecture(
  API_DEFAULT_JAVA_ARCHITECTURE_ID,
  "API Default (Java / JUnit 5 + AssertJ)",
  "java",
);
