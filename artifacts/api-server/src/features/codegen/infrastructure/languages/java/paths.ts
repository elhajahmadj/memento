// File path helpers for the Java codegen layout.
import type { Project } from "@/features/projects/domain/types";

export function testsModuleDir(project: Project): string {
  return `${project.solutionName}-tests`;
}

export function sharedModuleDir(project: Project): string {
  return `${project.solutionName}-shared`;
}

export function pkgPath(project: Project): string {
  // Project.namespace stores the flat lowercase Java package segment
  // (e.g. `myapp`). The on-disk directory under `src/main/java` /
  // `src/test/java` is just that single segment for our scaffolds.
  return project.namespace;
}

/** Relative path to a recorded test class, e.g. `MyApp-tests/src/test/java/myapp/tests/TestLogin.java`. */
export function testFileRelPath(project: Project, className: string): string {
  return `${testsModuleDir(project)}/src/test/java/${pkgPath(project)}/tests/Test${className}.java`;
}

export function selectorsFileRelPath(project: Project, suiteName: string): string {
  return `${testsModuleDir(project)}/src/test/java/${pkgPath(project)}/pages/selectors/${suiteName}Selectors.java`;
}

export function actionsFileRelPath(project: Project, suiteName: string): string {
  return `${testsModuleDir(project)}/src/test/java/${pkgPath(project)}/pages/actions/${suiteName}Actions.java`;
}

// Page-object interfaces live in the shared Maven module so other modules
// (and downstream consumers of the scaffolded project) can depend on them
// without pulling in the test runtime. This mirrors the C# layout where
// `IXyzActions` interfaces sit under `PageObjects/Interfaces`.
export function interfaceFileRelPath(project: Project, suiteName: string): string {
  return `${sharedModuleDir(project)}/src/main/java/${pkgPath(project)}/pages/interfaces/I${suiteName}Actions.java`;
}

/**
 * Strip the `TestSuite` / `Tests` / `Test` decoration off a suite name so
 * the bare suite identifier (e.g. `Login`) can be used to derive the
 * `<Suite>Constants` and `<Suite>TestCategories` class names.
 */
export function stripSuiteSuffix(name: string): string {
  if (/TestSuite$/.test(name)) return name.slice(0, -"TestSuite".length);
  if (/Tests$/.test(name)) return name.slice(0, -"Tests".length);
  if (/Test$/.test(name)) return name.slice(0, -"Test".length);
  return name;
}

/** `<Suite>Constants` class name derived from the suite name. */
export function suiteConstantsClassName(suiteName: string): string {
  const bare = stripSuiteSuffix(suiteName) || "Recorded";
  return `${bare}Constants`;
}

/** `<Suite>TestCategories` class name derived from the suite name. */
export function suiteTestCategoriesClassName(suiteName: string): string {
  const bare = stripSuiteSuffix(suiteName) || "Recorded";
  return `${bare}TestCategories`;
}

/** Per-suite Constants file path (under the tests module). */
export function suiteConstantsRelPath(
  project: Project,
  suiteName: string,
): string {
  const cls = suiteConstantsClassName(suiteName);
  return `${testsModuleDir(project)}/src/test/java/${pkgPath(project)}/constants/${cls}.java`;
}

/** Per-suite TestCategories file path (under the tests module). */
export function suiteTestCategoriesRelPath(
  project: Project,
  suiteName: string,
): string {
  const cls = suiteTestCategoriesClassName(suiteName);
  return `${testsModuleDir(project)}/src/test/java/${pkgPath(project)}/testcategories/${cls}.java`;
}
