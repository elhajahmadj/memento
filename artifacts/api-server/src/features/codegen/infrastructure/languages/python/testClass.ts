/**
 * Emit a fresh test class file under `tests/`. The class is intentionally
 * minimal — two empty hook fixtures (`one_time_setup`, `before_each`) that
 * `replaceHookBody` can target later by name + `yield` marker.
 */
import type { Project } from "@/features/projects/domain/types";
import { createFile } from "@/features/projects/infrastructure/projectFiles";
import { PYTHON_HOOK_INFO, testFileRelPath } from "./naming";

export async function generateTestClass(
  project: Project,
  className: string,
): Promise<string> {
  const rel = testFileRelPath(className);
  const content = `"""${className} tests."""
import pytest

from infrastructure.test_fixture_base import TestFixtureBase


class Test${className}(TestFixtureBase):
    @pytest.fixture(scope="class", autouse=True)
    def ${PYTHON_HOOK_INFO.oneTimeSetup.method}(self):
        # one_time_setup body
        yield

    @pytest.fixture(autouse=True)
    def ${PYTHON_HOOK_INFO.beforeEach.method}(self, page):
        # before_each body
        yield
`;
  await createFile(project, rel, content);
  return rel;
}
