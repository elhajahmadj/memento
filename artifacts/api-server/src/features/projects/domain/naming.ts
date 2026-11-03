/**
 * Pure naming helpers — derived module / package / project names from
 * a canonical solution name. No I/O, no architecture lookups.
 */

/**
 * Given a solution name that is already taken, return the first free
 * `<name><n>` variant (`Foo` → `Foo2`, `Foo3`, …).
 *
 * Used by the guest create path: guests share the flat workspace
 * namespace with projects they cannot see, so "that name is taken" is
 * a dead end unless we hand them one that isn't. The suffix keeps the
 * result a valid solution slug (see `validateSolutionName`), and the
 * returned name is guaranteed absent from `taken`.
 */
export function suggestFreeSolutionName(
  solutionName: string,
  taken: ReadonlySet<string>,
): string {
  // Terminates unconditionally: `taken` is finite, so some `n` in
  // `2..taken.size + 2` must be free.
  let n = 2;
  while (taken.has(`${solutionName}${n}`)) n++;
  return `${solutionName}${n}`;
}

export function infrastructureProjectName(solutionName: string): string {
  return `${solutionName}.Infrastructure`;
}
export function sharedProjectName(solutionName: string): string {
  return `${solutionName}.Shared`;
}
export function testsProjectName(solutionName: string): string {
  return `${solutionName}.Tests`;
}

/**
 * Convert a CamelCase solution name to a snake_case Python package name.
 * `MyApp` → `myapp`, `MySolutionName` → `my_solution_name`.
 */
export function pythonPackageName(solutionName: string): string {
  return solutionName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

export function pythonTestPackageName(solutionName: string): string {
  return `${pythonPackageName(solutionName)}_tests`;
}

/**
 * Convert a CamelCase solution name to a kebab-case npm package name
 * (`MyApp` → `my-app`). npm requires lowercase, no whitespace, and the
 * `name` field of `package.json` may not begin with a dot or underscore,
 * so we additionally strip any leading non-alphanumeric characters.
 */
export function nodejsPackageName(solutionName: string): string {
  return solutionName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^[-_.]+/, "")
    .toLowerCase();
}

/**
 * Convert a solution name into a Java package segment. Java packages
 * must be lower-case, alphanumeric and may not collide with reserved
 * words. We strip any character that isn't legal and lower-case the
 * result; if that leaves us with a leading digit (or an empty string)
 * we prepend `pkg` so the segment is always a valid Java identifier.
 */
export function javaPackageName(solutionName: string): string {
  const cleaned = solutionName.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (cleaned.length === 0) return "pkg";
  if (/^[0-9]/.test(cleaned)) return `pkg${cleaned}`;
  return cleaned;
}

/**
 * Module-name suffixes the Java scaffolder writes. Suite generation
 * (`javaCodegen`) needs the tests-module name to compute relative paths.
 */
export function javaTestsModuleName(solutionName: string): string {
  return `${solutionName}-tests`;
}
