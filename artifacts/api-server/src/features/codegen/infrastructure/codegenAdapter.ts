/**
 * Language-pluggable adapter over `codegen.ts` (C#), `pythonCodegen.ts`
 * (Python) and `nodejsCodegen.ts` (Node.js / `@playwright/test`). Every
 * function takes a `Project` and dispatches on `project.language` so the
 * recording service can stay language-agnostic.
 *
 * Existing C# call sites used to import the C# helpers directly. Going
 * through the adapter is what enables Python and Node.js projects to emit
 * their own files without forcing every call site to add a switch
 * statement.
 *
 * Some helpers (`csQuotedArg`, `renderAssertionLine`, …) live as separate
 * exports for each language so callers that build a body line-by-line
 * (recordingService.finalize) can pick the right one explicitly. This
 * keeps line emission readable rather than wrapping every line behind an
 * abstraction.
 */
import * as csharp from "@/features/codegen/infrastructure/csharpCodegen";
import * as python from "@/features/codegen/infrastructure/pythonCodegen";
import * as nodejs from "@/features/codegen/infrastructure/nodejsCodegen";
import * as java from "@/features/codegen/infrastructure/javaCodegen";
// JMX is an emission-only target — every dispatcher below already falls
// through to csharp via `default:` for unrecognized languages, so the
// stub adapter just needs to be reachable. Re-export keeps it
// discoverable from the single composition entry point that downstream
// JMX slices import from.
import { JmxCodegenAdapter } from "@/features/jmx/infrastructure/jmxCodegenAdapter";
export { JmxCodegenAdapter };
import type { Project } from "@/features/projects/domain/types";
import type { Language } from "@/features/architectures/infrastructure/architectureService";
import type {
  AddTestMethodOptions,
  AddTestMethodResult,
  HookKind,
  RecordedAction,
  ReplaceHookBodyResult,
  SuiteGenerationResult,
} from "@/features/codegen/infrastructure/csharpCodegen";
import {
  buildUrlEnvVarName as buildUrlEnvVarNameDomain,
  urlConfigPropertyName as urlConfigPropertyNameDomain,
  urlSafe as urlSafeDomain,
} from "@/features/codegen/domain/identifiers";

// Re-export the pure identifier helpers under their original names so
// existing callers continue to import them from `codegenAdapter.ts`.
// The canonical definitions live in `features/codegen/domain/identifiers.ts`.
export const urlSafe = urlSafeDomain;
export const buildUrlEnvVarName = buildUrlEnvVarNameDomain;
export const urlConfigPropertyName = urlConfigPropertyNameDomain;

/**
 * Pick the codegen module for `project.language`. Defaults to C# so any
 * project loaded from disk without an explicit language (the original
 * single-language storage shape) keeps generating C# the way it always
 * did.
 */
function langOf(project: Project): Language {
  return project.language ?? "csharp";
}

export function generateTestClass(
  project: Project,
  className: string,
): Promise<string> {
  switch (langOf(project)) {
    case "python":
      return python.generateTestClass(project, className);
    case "nodejs":
      return nodejs.generateTestClass(project, className);
    case "java":
      return java.generateTestClass(project, className);
    default:
      return csharp.generateTestClass(project, className);
  }
}

export function generateSuiteFiles(
  project: Project,
  suiteName: string,
  actions: RecordedAction[],
): Promise<SuiteGenerationResult> {
  switch (langOf(project)) {
    case "python":
      return python.generateSuiteFiles(project, suiteName, actions);
    case "nodejs":
      return nodejs.generateSuiteFiles(project, suiteName, actions);
    case "java":
      return java.generateSuiteFiles(project, suiteName, actions);
    default:
      return csharp.generateSuiteFiles(project, suiteName, actions);
  }
}

export function addTestMethod(
  project: Project,
  fileRelPath: string,
  methodName: string,
  bodyLines: string[],
  pageObjectsUsed: string[],
  options: AddTestMethodOptions = {},
): Promise<AddTestMethodResult> {
  switch (langOf(project)) {
    case "python":
      return python.addTestMethod(
        project,
        fileRelPath,
        methodName,
        bodyLines,
        pageObjectsUsed,
        options,
      );
    case "nodejs":
      return nodejs.addTestMethod(
        project,
        fileRelPath,
        methodName,
        bodyLines,
        pageObjectsUsed,
        options,
      );
    case "java":
      return java.addTestMethod(
        project,
        fileRelPath,
        methodName,
        bodyLines,
        pageObjectsUsed,
        options,
      );
    default:
      return csharp.addTestMethod(
        project,
        fileRelPath,
        methodName,
        bodyLines,
        pageObjectsUsed,
        options,
      );
  }
}

export function replaceHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
  bodyLines: string[],
): Promise<ReplaceHookBodyResult> {
  switch (langOf(project)) {
    case "python":
      return python.replaceHookBody(project, fileRelPath, hook, bodyLines);
    case "nodejs":
      return nodejs.replaceHookBody(project, fileRelPath, hook, bodyLines);
    case "java":
      return java.replaceHookBody(project, fileRelPath, hook, bodyLines);
    default:
      return csharp.replaceHookBody(project, fileRelPath, hook, bodyLines);
  }
}

export function checkTestMethodExists(
  project: Project,
  fileRelPath: string,
  methodName: string,
): Promise<{ exists: boolean; suggestedName: string }> {
  switch (langOf(project)) {
    case "python":
      return python.checkTestMethodExists(project, fileRelPath, methodName);
    case "nodejs":
      return nodejs.checkTestMethodExists(project, fileRelPath, methodName);
    case "java":
      return java.checkTestMethodExists(project, fileRelPath, methodName);
    default:
      return csharp.checkTestMethodExists(project, fileRelPath, methodName);
  }
}

export function readHookBody(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<string | null> {
  switch (langOf(project)) {
    case "python":
      return python.readHookBody(project, fileRelPath, hook);
    case "nodejs":
      return nodejs.readHookBody(project, fileRelPath, hook);
    case "java":
      return java.readHookBody(project, fileRelPath, hook);
    default:
      return csharp.readHookBody(project, fileRelPath, hook);
  }
}

export function isHookDefaultStub(
  project: Project,
  fileRelPath: string,
  hook: HookKind,
): Promise<boolean> {
  switch (langOf(project)) {
    case "python":
      return python.isHookDefaultStub(project, fileRelPath, hook);
    case "nodejs":
      return nodejs.isHookDefaultStub(project, fileRelPath, hook);
    case "java":
      return java.isHookDefaultStub(project, fileRelPath, hook);
    default:
      return csharp.isHookDefaultStub(project, fileRelPath, hook);
  }
}

export function readSuiteActionsMethodNames(
  project: Project,
  suiteName: string,
): Promise<Set<string>> {
  switch (langOf(project)) {
    case "python":
      return python.readSuiteActionsMethodNames(project, suiteName);
    case "nodejs":
      return nodejs.readSuiteActionsMethodNames(project, suiteName);
    case "java":
      return java.readSuiteActionsMethodNames(project, suiteName);
    default:
      return csharp.readSuiteActionsMethodNames(project, suiteName);
  }
}

export function readRecordedConstants(
  project: Project,
  suiteName?: string,
): Promise<Map<string, string>> {
  switch (langOf(project)) {
    case "python":
      // Python switched to per-suite constants files; the legacy
      // shared/constants.py is no longer read. When no suiteName is
      // provided (e.g. preview paths that don't yet know the suite),
      // return an empty map so callers fall back to "no recorded values".
      if (!suiteName) return Promise.resolve(new Map());
      return python.readRecordedConstants(project, suiteName);
    case "nodejs":
      // Task #196: Node.js routes to per-suite `constants/{kebab}.constants.ts`
      // when a suite name is supplied; falls back to legacy
      // `shared/constants.ts` for callers (or older code paths) that
      // don't know the suite yet.
      return suiteName
        ? nodejs.readSuiteConstants(project, suiteName)
        : nodejs.readRecordedConstants(project);
    case "java":
      return java.readRecordedConstants(project, suiteName);
    default:
      return csharp.readRecordedConstants(project, suiteName);
  }
}

export function writeRecordedConstants(
  project: Project,
  byName: Map<string, string>,
  suiteName?: string,
): Promise<string> {
  switch (langOf(project)) {
    case "python":
      if (!suiteName) {
        return Promise.reject(
          new Error(
            "writeRecordedConstants(python) requires a suiteName — per-suite constants files have no shared fallback.",
          ),
        );
      }
      return python.writeRecordedConstants(project, byName, suiteName);
    case "nodejs":
      // Task #196: per-suite `${Suite}Constants` lives at
      // `constants/{kebab}.constants.ts`. Without a suite name we keep
      // the legacy `shared/constants.ts` writer for back-compat.
      return suiteName
        ? nodejs.writeSuiteConstants(project, suiteName, byName)
        : nodejs.writeRecordedConstants(project, byName);
    case "java":
      return java.writeRecordedConstants(project, byName, suiteName);
    default:
      return csharp.writeRecordedConstants(project, byName, suiteName);
  }
}

/**
 * Idempotently upsert a `{Suite}Categories` constant into the per-suite
 * `test_categories/{snake}_categories.py` file. Python-only — returns
 * `null` for other languages so call sites can stay language-agnostic.
 */
export function ensureCategoryFile(
  project: Project,
  suiteName: string,
  constantName: string,
  value: string,
): Promise<string | null> {
  if (langOf(project) !== "python") return Promise.resolve(null);
  return python.ensureCategoryFile(project, suiteName, constantName, value);
}

/** Quote a literal value the way the project's language expects it. */
export function quotedArg(project: Project, value: string): string {
  switch (langOf(project)) {
    case "python":
      return python.pyQuotedArg(value);
    case "nodejs":
      return nodejs.tsQuotedArg(value);
    case "java":
      return java.javaQuotedArg(value);
    default:
      return csharp.csQuotedArg(value);
  }
}

/** Render a single assertion line in the project's language. */
export function renderAssertionLine(
  project: Project,
  a: RecordedAction,
): string | null {
  switch (langOf(project)) {
    case "python":
      return python.renderAssertionLinePython(a);
    case "nodejs":
      return nodejs.renderAssertionLineNodejs(a);
    case "java":
      return java.renderAssertionLineJava(a);
    default:
      return csharp.renderAssertionLine(a);
  }
}

/** Render a single wait line in the project's language. */
export function renderWaitLine(
  project: Project,
  a: RecordedAction,
): string | null {
  switch (langOf(project)) {
    case "python":
      return python.renderWaitLinePython(a);
    case "nodejs":
      return nodejs.renderWaitLineNodejs(a);
    case "java":
      return java.renderWaitLineJava(a);
    default:
      return csharp.renderWaitLine(a);
  }
}

/**
 * Render a `routeMock` line for the project's language. Returns null
 * for non-routeMock actions or actions missing a URL pattern. Mock
 * lines are emitted ONCE before the test's `page.goto(...)` so the
 * interception is in place when the page begins navigating.
 */
export function renderRouteMockLine(
  project: Project,
  a: RecordedAction,
): string | null {
  switch (langOf(project)) {
    case "python":
      return python.renderRouteMockLinePython(a);
    case "nodejs":
      return nodejs.renderRouteMockLineNodejs(a);
    case "java":
      return java.renderRouteMockLineJava(a);
    default:
      return csharp.renderRouteMockLine(a);
  }
}

/**
 * Render an `apiAssertion` line for the project's language. Returns
 * null for non-apiAssertion actions or actions missing a URL. API
 * assertions are emitted inline alongside other assertions.
 */
export function renderApiAssertionLine(
  project: Project,
  a: RecordedAction,
): string | null {
  switch (langOf(project)) {
    case "python":
      return python.renderApiAssertionLinePython(a);
    case "nodejs":
      return nodejs.renderApiAssertionLineNodejs(a);
    case "java":
      return java.renderApiAssertionLineJava(a);
    default:
      return csharp.renderApiAssertionLine(a);
  }
}

/**
 * Build the lines that initialize the page-object actions instance and
 * navigate to the recorded start URL. The languages differ enough
 * (await + interface vs plain instantiation, `Page.GotoAsync` vs
 * `page.goto` vs `await page.goto`) that we generate them here rather
 * than in the call site.
 */
/**
 * Regenerate the per-language `TestConfig` file from the project's
 * current named-URL store. Mirrors C#'s
 * `csharp.regenerateTestConfig(project)` for the .env-backed languages:
 * reads URL names off `<root>/.env` (matching the format
 * `upsertNamedUrlDotenv` writes) and rewrites the `<auto-generated-urls>`
 * block inside the scaffold's TestConfig file.
 *
 * Returns the relative path of the file written, or `null` when there
 * is no scaffold file to update (custom architecture, missing `.env`,
 * etc.). Best-effort by design — callers wrap in try/catch.
 */
export async function regenerateTestConfig(
  project: Project,
): Promise<string | null> {
  const lang = langOf(project);
  if (lang === "csharp") return csharp.regenerateTestConfig(project);
  const urlNames = await readUrlNamesFromDotenv(project);
  switch (lang) {
    case "python":
      return python.regenerateTestConfig(project, urlNames);
    case "nodejs":
      return nodejs.regenerateTestConfig(
        project,
        urlNames,
        project.solutionName,
      );
    case "java":
      return java.regenerateTestConfig(
        project,
        urlNames,
        project.solutionName,
      );
    default:
      return null;
  }
}

/**
 * Pull the `<NAME>` suffixes out of every `<SOLUTION>_URL_<NAME>=...`
 * line in `<root>/.env`. Mirrors the parser in
 * `recordingService.readNamedUrlsDotenv` but stays local to this module
 * to avoid a cycle (recordingService → codegenAdapter → recordingService).
 */
async function readUrlNamesFromDotenv(project: Project): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const envPath = path.join(project.rootPath, ".env");
  let raw: string;
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return [];
  }
  const prefix = `${urlSafe(project.solutionName)}_URL_`;
  const out: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.replace(/^\s+/, "");
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export "))
      line = line.slice("export ".length).replace(/^\s+/, "");
    if (!line.startsWith(prefix)) continue;
    const eq = line.indexOf("=");
    if (eq <= prefix.length) continue;
    const key = line.slice(0, eq).trimEnd();
    if (!key.startsWith(prefix) || key.length === prefix.length) continue;
    let value = line.slice(eq + 1).replace(/^\s+/, "");
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.indexOf("#");
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trimEnd();
    }
    if (!value) continue;
    out.push(key.slice(prefix.length));
  }
  return out;
}

export function buildSuiteHeaderLines(
  project: Project,
  suiteName: string,
  urlName: string,
): { header: string[]; actionsVar: string } {
  const lang = langOf(project);
  // All four supported languages now share the typed `TestConfig.<NAME>`
  // accessor for named start URLs (mirroring the C# pattern). The
  // property name is the upper-cased / underscore-collapsed form of the
  // urlName — the same transformation `buildUrlEnvVarName` applies to
  // build the `<SOLUTION>_URL_<NAME>` env-var suffix — so the recorder
  // can regenerate the per-language `TestConfig` file from nothing but
  // the `.env` keys.
  const propName = urlConfigPropertyName(urlName);
  if (lang === "python") {
    const actionsVar = "actions";
    return {
      actionsVar,
      header: [
        `${actionsVar} = ${suiteName}Actions(page)`,
        `page.goto(TestConfig.${propName})`,
      ],
    };
  }
  if (lang === "nodejs") {
    const actionsVar = "actions";
    return {
      actionsVar,
      header: [
        `const ${actionsVar} = new ${suiteName}Actions(page);`,
        `await page.goto(TestConfig.${propName});`,
      ],
    };
  }
  if (lang === "java") {
    const actionsVar = "actions";
    return {
      actionsVar,
      header: [
        `I${suiteName}Actions ${actionsVar} = new ${suiteName}Actions(page);`,
        `page.navigate(TestConfig.${propName});`,
      ],
    };
  }
  const actionsVar = "actions";
  return {
    actionsVar,
    header: [
      `I${suiteName}Actions ${actionsVar} = new ${suiteName}Actions(Page);`,
      `await Page.GotoAsync(TestConfig.${urlName});`,
    ],
  };
}

/**
 * Render a "call this method on the actions object" line for any
 * supported language. `arg` may be empty for no-arg methods or a
 * fully-quoted literal / constant reference.
 */
export function renderActionCallLine(
  project: Project,
  actionsVar: string,
  methodName: string,
  arg: string,
): string {
  switch (langOf(project)) {
    case "python":
      return `${actionsVar}.${methodName}(${arg})`;
    case "nodejs":
      return `await ${actionsVar}.${methodName}(${arg});`;
    case "java":
      return `${actionsVar}.${methodName}(${arg});`;
    default:
      return `await ${actionsVar}.${methodName}(${arg});`;
  }
}

/**
 * For the constant reference inside the call line. C# uses
 * `Constants.UserName`, Python uses `Constants.USER_NAME` (UPPER_SNAKE),
 * and Node.js uses `Constants.userName` (camelCase).
 */
export function constantsRef(
  project: Project,
  constName: string,
  suiteName?: string,
): string {
  switch (langOf(project)) {
    case "python": {
      const upper = constName
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();
      // Per-suite Constants class — fall back to the legacy `Constants`
      // alias when the caller hasn't supplied a suiteName so live previews
      // that don't yet know the suite name don't crash.
      const className = suiteName
        ? python.constantsClassNameForSuite(suiteName)
        : "Constants";
      return `${className}.${upper}`;
    }
    case "nodejs": {
      const camel = constName.charAt(0).toLowerCase() + constName.slice(1);
      // Task #196: per-suite Constants object — `${Suite}Constants.foo`.
      // Falls back to the legacy global `Constants.foo` when no suite
      // name was supplied (older callers / non-suite contexts).
      const objectName = suiteName ? `${suiteName}Constants` : "Constants";
      return `${objectName}.${camel}`;
    }
    case "java": {
      // Java's recorded constants live in a per-suite class
      // (`<Suite>Constants.<camelName>`) emitted by
      // `javaCodegen.writeRecordedConstants` into `tests/<pkg>/constants/`.
      // Without a suiteName we can't reference the right class, so fall
      // back to a bare `Constants.x` (kept for adapter callers that don't
      // have a suite context — Java recordings always have one).
      const camel = constName.charAt(0).toLowerCase() + constName.slice(1);
      const cls = suiteName
        ? java.suiteConstantsClassName(suiteName)
        : "Constants";
      return `${cls}.${camel}`;
    }
    default: {
      const cls = suiteName
        ? csharp.suiteConstantsClassName(suiteName)
        : "Constants";
      return `${cls}.${constName}`;
    }
  }
}

/**
 * Java-only side-emit: idempotently upsert a `public static final String
 * NAME = "value";` constant into the per-suite `<Suite>TestCategories.java`
 * file (under `tests/<pkg>/testcategories/`). No-op for other languages.
 * Returns the relative path of the written file (or `null` for non-Java
 * projects).
 */
export function upsertTestCategoryConstant(
  project: Project,
  suiteName: string,
  constantName: string,
  value: string,
): Promise<string | null> {
  if (langOf(project) !== "java") return Promise.resolve(null);
  return java.upsertTestCategoryConstantJava(
    project,
    suiteName,
    constantName,
    value,
  );
}

// ---------------------------------------------------------------------------
// Verb-noun naming dispatch (task 52)
// ---------------------------------------------------------------------------
//
// All three "first-class" languages (C# / Python / Node.js) share a
// noun-only prompt-prefill flow: the user types a noun (`LoginButton` /
// `login_button` / `loginButton`), the recorder normalizes it, and the
// codegen decorates it as `${verb}${noun}` in the language's casing.
// Java is intentionally OUT OF SCOPE for task 52 and falls back to the
// legacy "raw method name" path that pre-dates the noun convention.

/**
 * Strip the language's verb-prefix decoration from a user-typed noun
 * candidate. Always returns the bare noun in the language's preferred
 * casing — empty string if the input had no usable identifier characters.
 */
export function normalizeNoun(project: Project, name: string): string {
  switch (langOf(project)) {
    case "python":
      return python.normalizeNounForPython(name);
    case "nodejs":
      return nodejs.normalizeNounForNodejs(name);
    case "java":
      return (name ?? "").trim();
    default:
      return csharp.normalizeNounForCsharp(name);
  }
}

/**
 * Decorate a bare noun into the full method name the codegen will emit.
 * Java has no decoration so the noun is returned unchanged.
 */
export function methodNameFromNoun(
  project: Project,
  type: RecordedAction["type"],
  noun: string,
): string {
  switch (langOf(project)) {
    case "python":
      return python.pythonMethodNameFromNoun(type, noun);
    case "nodejs":
      return nodejs.nodejsMethodNameFromNoun(type, noun);
    case "java":
      return noun;
    default:
      return csharp.csharpMethodNameFromNoun(type, noun);
  }
}

/**
 * Suggest the full decorated method name for the *last* recorded action
 * — used to seed the live preview shown next to the rename prompt input.
 * For Java (out of scope) this falls back to codegen.ts's legacy form so
 * existing behavior is preserved.
 */
export function suggestedMethodNameForLastAction(
  project: Project,
  actions: RecordedAction[],
): string | null {
  switch (langOf(project)) {
    case "python":
      return python.suggestedMethodNameForLastActionPython(actions);
    case "nodejs":
      return nodejs.suggestedMethodNameForLastActionNodejs(actions);
    case "java":
      // Java keeps the pre-task-52 legacy form (`ClickSubmit1`).
      return csharp.suggestedMethodNameForLastAction(actions, "java");
    default:
      return csharp.suggestedMethodNameForLastAction(actions, "csharp");
  }
}

/**
 * Suggest the bare noun for the *last* recorded action — used to
 * pre-fill the rename prompt's text input. Returns null for Java since
 * the prompt for Java projects shows the full method name directly.
 */
export function suggestedActionNoun(
  project: Project,
  actions: RecordedAction[],
): string | null {
  switch (langOf(project)) {
    case "python":
      return python.suggestedActionNounForLastActionPython(actions);
    case "nodejs":
      return nodejs.suggestedActionNounForLastActionNodejs(actions);
    case "java":
      return null;
    default:
      return csharp.suggestedActionNounForLastAction(actions);
  }
}

/**
 * Read the on-disk Selectors map for `suiteName` so the live test-body
 * preview can merge with previously-recorded entries (and so dedup
 * suffixes match what stop()'s file write would produce).
 */
export function readSuiteExistingSelectors(
  project: Project,
  suiteName: string,
): Promise<Map<string, string>> {
  switch (langOf(project)) {
    case "python":
      return python.readSuiteExistingSelectorsPython(project, suiteName);
    case "nodejs":
      return nodejs.readSuiteExistingSelectorsNodejs(project, suiteName);
    case "java":
      // Java's preview path shares the C# legacy preview, which doesn't
      // care about Java's actual on-disk Selectors layout — return an
      // empty map rather than crash.
      return Promise.resolve(new Map());
    default:
      return csharp.readSuiteExistingSelectors(project, suiteName);
  }
}

/**
 * Compute the test-body preview lines (and per-line action indices) for
 * the workbench's live preview pane. Mirrors `stop()`'s body assembly
 * for the project's language so the preview matches the file write.
 */
export function computeTestBodyPreview(
  project: Project,
  suiteName: string,
  urlName: string,
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
): { lines: string[]; lineActionIndices: Array<number | null> } {
  switch (langOf(project)) {
    case "python":
      return python.computeTestBodyPreviewPython(
        suiteName,
        urlName,
        actions,
        existingSelectors,
      );
    case "nodejs":
      return nodejs.computeTestBodyPreviewNodejs(
        suiteName,
        urlName,
        actions,
        existingSelectors,
      );
    case "java":
      // Java keeps the pre-task-52 legacy preview (which renders the
      // C#-flavored `await actions.X()` shape with legacy method names).
      return csharp.computeTestBodyPreview(
        suiteName,
        urlName,
        actions,
        existingSelectors,
        "java",
      );
    default:
      return csharp.computeTestBodyPreview(
        suiteName,
        urlName,
        actions,
        existingSelectors,
        "csharp",
      );
  }
}

/**
 * Sanitize a shared-step name into a valid C# identifier so the
 * generated `<Name>Steps` class + helper filename + RunAsync call
 * site all compile. The user-typed shared-step name is preserved as
 * the display label everywhere; this helper is only used at codegen
 * emission points. Returns `"Macro"` when the input had no usable
 * characters. No-op for non-C# projects (callers should only invoke
 * this for the C# emit path).
 */
export function csharpMacroIdentifier(name: string): string {
  return csharp.toCsharpMacroIdentifier(name);
}

/**
 * T003 — Write the per-macro `<MacroName>Steps` helper file. Macro
 * grouping in the generated test body is C#-only (other languages
 * still call individual page-object methods inline), so this is a
 * thin pass-through to the C# implementation when the project is C#
 * and a no-op for other languages. `bodyLines` are the already-rendered
 * C# call lines (e.g. `await actions.ClickLogin();`) the recording
 * service has accumulated for this macro. Returns the relative helper
 * file path that was written, or `null` for non-C# projects.
 */
export function writeMacroHelperFile(
  project: Project,
  suiteName: string,
  macroName: string,
  bodyLines: string[],
): Promise<string | null> {
  if (langOf(project) !== "csharp") return Promise.resolve(null);
  return csharp.writeMacroHelperFile(
    project,
    suiteName,
    macroName,
    bodyLines,
  );
}

/**
 * True when the project's language uses the noun-only prompt flow
 * (separate noun storage + decorated method name + live preview).
 * Currently C#, Python, and Node.js. Java is out of scope.
 */
export function usesNounPromptFlow(project: Project): boolean {
  const lang = langOf(project);
  return lang === "csharp" || lang === "python" || lang === "nodejs";
}
