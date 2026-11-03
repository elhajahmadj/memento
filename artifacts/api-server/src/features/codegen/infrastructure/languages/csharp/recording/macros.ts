/**
 * Shared-step helper file emitter. When the user marks a contiguous run
 * of recorded actions as a macro (a reusable shared step), the recorder
 * emits a `{TestProject}/SharedSteps/{MacroName}Steps.cs` file whose
 * `RunAsync(I{Suite}Actions actions)` body is the inline action call
 * lines the macro would have produced in the [Test] body, and rewrites
 * the test body itself to `await {MacroName}Steps.RunAsync(actions);`.
 */
import type { Project } from "@/features/projects/domain/types";
import { writeFile } from "@/features/projects/infrastructure/projectFiles";
import { toCsharpMacroIdentifier } from "./identifiers";

export async function writeMacroHelperFile(
  project: Project,
  suiteName: string,
  macroName: string,
  bodyLines: string[],
): Promise<string> {
  const symbol = toCsharpMacroIdentifier(macroName);
  const rel = `${project.testProjectName}/SharedSteps/${symbol}Steps.cs`;
  const indent = "            ";
  const body =
    bodyLines.length > 0
      ? bodyLines.map((l) => `${indent}${l}`).join("\n")
      : `${indent}await Task.CompletedTask;`;
  const content = `using System.Threading.Tasks;
using ${project.namespace}.Tests.PageObjects.Interfaces;

namespace ${project.namespace}.Tests.SharedSteps
{
    public static class ${symbol}Steps
    {
        public static async Task RunAsync(I${suiteName}Actions actions)
        {
${body}
        }
    }
}
`;
  await writeFile(project, rel, content);
  return rel;
}
