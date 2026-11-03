import type { AiRunReport } from "@/features/ai-agent/domain/types";
import { safeIdentifier, stripSuiteSuffix } from "./identifiers";
import { readExistingClassAndNamespace } from "./discovery";

export interface ResolvedClass {
  /** The C# class name to declare in the emitted test file. */
  className: string;
  /** Sanitized stem (no trailing `Test`/`Tests`/`TestSuite`). */
  suiteStem: string;
  /** Page object name derived from the stem, e.g. `LoginPage`. */
  pageName: string;
  /** Interface name for the page object, e.g. `ILoginPage`. */
  interfaceName: string;
  /** True when targeting an existing suite (emit a `partial class`). */
  isAddMethod: boolean;
  /**
   * The exact namespace declared in the user-picked file (add_method
   * only). Used as the companion partial class's namespace so the
   * C# compiler merges the partials at build time. Null in
   * new_suite mode (caller falls back to `${ns}.Tests`).
   */
  existingNamespace: string | null;
}

/**
 * Resolve the (className, suiteStem, pageName, interfaceName) tuple
 * for the run. In add_method mode the authoritative class + stem
 * come from the selected existing suite file — NOT from the user-
 * typed suiteName, which we now treat as the optional method name.
 * Parsing the file for its declared class name lets the companion
 * sidecar attach as a `partial class` of the same name (C# then
 * merges them at build time).
 *
 * HARD INVARIANT: add_method MUST attach to the user-selected
 * existing suite. If we can't read or parse the file to learn its
 * class name, we MUST NOT fall back to the new-suite path (which
 * would silently create a brand-new `{Stem}TestSuite.cs` beside the
 * user's chosen file and split the run's new method off into a
 * sibling class — the exact bug task #98 set out to fix). Fail the
 * run with an actionable error instead.
 */
export async function resolveClass(args: {
  projectRoot: string;
  report: AiRunReport;
  targetMode: "new_suite" | "add_method";
  existingSuiteFile: string | null;
}): Promise<ResolvedClass> {
  let resolvedClassName: string | null = null;
  let resolvedNamespace: string | null = null;
  const isAddMethod = args.targetMode === "add_method";
  if (isAddMethod) {
    if (!args.existingSuiteFile) {
      throw new Error(
        "Build with AI: add_method requested but no existing suite file was selected. " +
          "Pick a suite from the 'Existing suite file' dropdown or switch to 'New test suite'.",
      );
    }
    const parsed = await readExistingClassAndNamespace(
      args.projectRoot,
      args.existingSuiteFile,
    );
    resolvedClassName = parsed.className;
    resolvedNamespace = parsed.namespace;
    if (!resolvedClassName) {
      throw new Error(
        `Build with AI: cannot attach to '${args.existingSuiteFile}' — the file is missing, unreadable, or contains no top-level C# class declaration. ` +
          "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      );
    }
  }
  // Page name is derived from the suite name. "LoginTest" -> "Login",
  // "LoginTests" -> "Login", "CheckoutFlow" -> "CheckoutFlow",
  // "LoginTestSuite" -> "Login". Sanitize through `safeIdentifier` so
  // a hostile suite name can't escape the project root via path
  // separators or other punctuation.
  const suiteStem = safeIdentifier(
    stripSuiteSuffix(resolvedClassName ?? args.report.suiteName),
    "Generated",
  );
  const pageName = `${suiteStem}Page`;
  const interfaceName = `I${pageName}`;
  // New suites adopt the `{Stem}TestSuite.cs` / `class {Stem}TestSuite`
  // convention so they're visibly distinct from hand-written `*Tests.cs`
  // fixtures and pair cleanly with the hidden `{Stem}TestSuiteSetup`
  // sidecar. In add_method mode we reuse the existing suite's class
  // name verbatim and emit a `partial class` companion.
  const className = isAddMethod
    ? resolvedClassName!
    : `${suiteStem}TestSuite`;
  return {
    className,
    suiteStem,
    pageName,
    interfaceName,
    isAddMethod,
    existingNamespace: resolvedNamespace,
  };
}
