import type { Project } from "@/features/projects/domain/types";
import { createFile } from "@/features/projects/infrastructure/projectFiles";
import { testFileRelPath } from "./paths";

/**
 * Emit a fresh `<Class>.spec.ts` file under `tests/`.
 */
export async function generateTestClass(
  project: Project,
  className: string,
): Promise<string> {
  const rel = testFileRelPath(className);
  const content = `import { test, expect } from "../shared/fixtures";

test.describe("${className}", () => {
  test.beforeAll(async () => {
    // beforeAll body
  });

  test.beforeEach(async ({ page }) => {
    // beforeEach body
  });
});
`;
  await createFile(project, rel, content);
  return rel;
}
