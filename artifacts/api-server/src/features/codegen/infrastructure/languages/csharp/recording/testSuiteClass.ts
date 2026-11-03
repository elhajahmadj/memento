/**
 * Emit the empty C# test-suite class file (NUnit `[TestFixture]` shell)
 * — the first file written when a user starts a brand-new recording.
 */
import type { Project } from "@/features/projects/domain/types";
import { createFile } from "@/features/projects/infrastructure/projectFiles";

/**
 * Normalize a user-typed C# test-suite class name so the on-disk file
 * and class always end with `TestSuite`. Mirrors the AI-flow rule from
 * task #98: a suite typed as `LoginPage` becomes `LoginPageTestSuite`,
 * while a suite already typed as `LoginPageTestSuite` is left alone
 * (no double-suffix). Whitespace is trimmed first so `"  LoginPage  "`
 * also normalizes cleanly. Page-object / Selectors / Interfaces /
 * Actions filenames are unaffected — they keep deriving from the raw
 * user-typed suite name elsewhere in the recorder pipeline.
 */
export function normalizeCsharpTestSuiteClassName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith("TestSuite") ? trimmed : `${trimmed}TestSuite`;
}

export async function generateTestClass(
  project: Project,
  className: string,
): Promise<string> {
  const resolved = normalizeCsharpTestSuiteClassName(className);
  const rel = `${project.testProjectName}/Tests/${resolved}.cs`;
  const content = `using System.Threading.Tasks;
using NUnit.Framework;
using ${project.namespace}.Infrastructure.Fixtures;

namespace ${project.namespace}.Tests
{
    [TestFixture]
    public class ${resolved} : TestFixture
    {
        [OneTimeSetUp]
        public Task OneTimeSetUpAsync()
        {
            return Task.CompletedTask;
        }

        [SetUp]
        public Task BeforeEachAsync()
        {
            return Task.CompletedTask;
        }

        [TearDown]
        public Task AfterEachAsync()
        {
            return Task.CompletedTask;
        }
    }
}
`;
  await createFile(project, rel, content);
  return rel;
}
