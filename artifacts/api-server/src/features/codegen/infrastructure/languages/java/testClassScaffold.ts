// Empty Java test-class scaffold emitter.
import type { Project } from "@/features/projects/domain/types";
import { createFile } from "@/features/projects/infrastructure/projectFiles";
import { pkgPath, testFileRelPath } from "./paths";

// Emit a fresh `Test<Class>.java`. Extends TestFixtureBase so the
// inherited `page` is wired up automatically via JUnit 5 lifecycle.
export async function generateTestClass(
  project: Project,
  className: string,
): Promise<string> {
  const rel = testFileRelPath(project, className);
  const pkg = pkgPath(project);
  const content = `package ${pkg}.tests;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import ${pkg}.infrastructure.fixtures.TestFixtureBase;

class Test${className} extends TestFixtureBase {
    @BeforeAll
    static void beforeAll() {
        // beforeAll body
    }

    @BeforeEach
    void beforeEach() {
        // beforeEach body
    }
}
`;
  await createFile(project, rel, content);
  return rel;
}
