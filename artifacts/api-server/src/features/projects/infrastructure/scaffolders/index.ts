import {
  type Architecture,
  ArchitectureSchema,
  architectureLanguage,
} from "@/features/architectures/infrastructure/architectureService";
import type { Project } from "../../domain/types";
import { scaffoldCsharpFromArchitecture } from "./csharpScaffolder";
import { scaffoldPythonFromArchitecture } from "./pythonScaffolder";
import { scaffoldNodejsFromArchitecture } from "./nodejsScaffolder";
import { scaffoldJavaFromArchitecture } from "./javaScaffolder";
import { createJmxScaffold } from "@/features/jmx/infrastructure/jmxScaffolder";

/**
 * Dispatch scaffolding to the per-language adapter. Re-validates the
 * incoming architecture so even non-route callers cannot bypass
 * path-segment safety checks.
 */
export async function scaffoldFromArchitecture(
  arch: Architecture,
  solutionName: string,
  namespace: string,
): Promise<Project> {
  const validated = ArchitectureSchema.parse(arch);
  const language = architectureLanguage(validated);

  if (language === "python") {
    return scaffoldPythonFromArchitecture(validated, solutionName, namespace);
  }
  if (language === "nodejs") {
    return scaffoldNodejsFromArchitecture(validated, solutionName, namespace);
  }
  if (language === "java") {
    return scaffoldJavaFromArchitecture(validated, solutionName, namespace);
  }
  if (language === "jmx") {
    return createJmxScaffold(solutionName, namespace);
  }
  return scaffoldCsharpFromArchitecture(validated, solutionName, namespace);
}

export {
  scaffoldCsharpFromArchitecture,
  scaffoldPythonFromArchitecture,
  scaffoldNodejsFromArchitecture,
  scaffoldJavaFromArchitecture,
  createJmxScaffold,
};
