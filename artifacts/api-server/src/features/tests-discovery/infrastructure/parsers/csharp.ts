import type { ParsedMethod } from "../../domain/types";

/** Strip line-comments and block-comments so attribute scans don't hit commented-out tests. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// All attribute regexes accept an optional dotted-namespace prefix so
// fully-qualified forms like `[NUnit.Framework.Test]`,
// `[NUnit.Framework.Category("…")]`, and `[Xunit.Fact]` are recognized
// alongside the bare unqualified attributes. The prefix is a
// non-capturing group of `Identifier.` repeated zero or more times.
const ATTR_NS = "(?:[A-Za-z_]\\w*\\s*\\.\\s*)*";
const CATEGORY_RE = new RegExp(
  `\\[\\s*${ATTR_NS}Category\\s*\\(\\s*"([^"]+)"\\s*\\)\\s*\\]`,
  "g",
);
// NUnit constant form. The same companion-class shape as xUnit's
// `[Trait("Category", FooTestCategories.Smoke)]` shows up here as
// `[Category(FooTestCategories.Smoke)]`. Capture both the class name
// and the trailing identifier so the same cross-file resolver can
// look up the constant's actual string value.
const CATEGORY_CONST_RE = new RegExp(
  `\\[\\s*${ATTR_NS}Category\\s*\\(\\s*([A-Za-z_]\\w*)\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\)\\s*\\]`,
  "g",
);
// xUnit equivalent. Two forms the codegen can emit:
//   [Trait("Category", "smoke")]
//   [Trait("Category", FooTestCategories.Smoke)]
// We pick up the literal-string form by value, and the constants form
// by capturing both the class name and the trailing identifier so the
// resolver (when supplied) can look up the constant's actual string
// value in a sibling `TestCategories/*.cs` file.
const TRAIT_CATEGORY_LITERAL_RE = new RegExp(
  `\\[\\s*${ATTR_NS}Trait\\s*\\(\\s*"Category"\\s*,\\s*"([^"]+)"\\s*\\)\\s*\\]`,
  "g",
);
const TRAIT_CATEGORY_CONST_RE = new RegExp(
  `\\[\\s*${ATTR_NS}Trait\\s*\\(\\s*"Category"\\s*,\\s*([A-Za-z_]\\w*)\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\)\\s*\\]`,
  "g",
);

/**
 * Optional resolver supplied by the discovery service: maps a C#
 * `ClassName.Member` pair (e.g. `HealthChecksTestCategories.Smoke`) to
 * its declared string value (e.g. `"smoke-tests"`) by reading the
 * sibling `TestCategories/*.cs` file. When the resolver yields a value
 * we add both the constant's identifier and its resolved value to the
 * method's tags so either can be used as a classifier override.
 */
export type CategoryConstantResolver = (
  className: string,
  member: string,
) => string | undefined;

export interface ParseCSharpOptions {
  resolveCategoryConstant?: CategoryConstantResolver;
}

function extractCategoryTags(
  attrBlock: string,
  resolve?: CategoryConstantResolver,
): string[] {
  const out: string[] = [];
  for (const m of attrBlock.matchAll(CATEGORY_RE)) {
    out.push(m[1]!);
  }
  for (const m of attrBlock.matchAll(TRAIT_CATEGORY_LITERAL_RE)) {
    out.push(m[1]!);
  }
  for (const m of attrBlock.matchAll(CATEGORY_CONST_RE)) {
    const className = m[1]!;
    const member = m[2]!;
    out.push(member);
    const resolved = resolve?.(className, member);
    if (resolved !== undefined && resolved !== member) {
      out.push(resolved);
    }
  }
  for (const m of attrBlock.matchAll(TRAIT_CATEGORY_CONST_RE)) {
    const className = m[1]!;
    const member = m[2]!;
    out.push(member);
    const resolved = resolve?.(className, member);
    if (resolved !== undefined && resolved !== member) {
      out.push(resolved);
    }
  }
  return out;
}

interface CsClass {
  name: string;
  classTags: string[];
  body: string;
  /**
   * True when the class itself carries an explicit
   * `[TestFixture]` / `[TestFixture(...)]` class-level attribute
   * (also matches fully-qualified `[NUnit.Framework.TestFixture]`).
   *
   * NOTE: `abstract` on its own is intentionally NOT treated as a
   * fixture signal here. An `abstract class` becomes a fixture only
   * when it also carries `[TestFixture]` OR has setup/teardown/test
   * methods inside — see the rollup in `parseCSharpFile`. Otherwise
   * abstract helper / POCO base classes would leak into the
   * "existing suite" dropdown.
   */
  isFixture: boolean;
}

/**
 * Parse C# (NUnit) test methods. Returns the namespace + a list of
 * `{ id, name, tags }` records suitable for the shared classifier.
 *
 * Best-effort regex parsing — handles the codegen-emitted shape:
 *
 *   namespace Memento.Tests.Login {
 *     [Category("E2E")]
 *     public class LoginSuite { [Test] public void HappyPath() {} }
 *   }
 *
 * Also supports file-scoped namespaces (`namespace X.Y;`).
 * `[TestCase(...)]` parameterized tests collapse into the parent
 * method id so running the leaf runs every case.
 */
export function parseCSharpFile(
  rawSource: string,
  opts: ParseCSharpOptions = {},
): {
  namespace: string | null;
  methods: ParsedMethod[];
  /**
   * True when the file looks like a real test fixture even if it
   * contains zero `[Test]` / `[TestCase]` / `[Fact]` / `[Theory]`
   * methods. We treat the following as fixture signals:
   *   - a class-level `[TestFixture]` / `[TestFixture(...)]` attribute
   *     (also matches fully-qualified `[NUnit.Framework.TestFixture]`),
   *     or
   *   - a method-level setup/teardown attribute (`[SetUp]`,
   *     `[OneTimeSetUp]`, `[TearDown]`, `[OneTimeTearDown]`, plus their
   *     fully-qualified forms).
   *
   * `abstract` on its own is intentionally NOT a fixture signal —
   * abstract helper / POCO base classes would otherwise leak into the
   * "existing suite" dropdown. An abstract base fixture is still
   * surfaced because real base fixtures carry a setup/teardown method
   * (or a `[TestFixture]` attribute).
   *
   * Files with no fixture signals at all (helpers, POCOs,
   * `TestCategories/*.cs`) are not fixtures.
   */
  isFixture: boolean;
} {
  const src = stripComments(rawSource);
  // Namespace — file-scoped wins if present; otherwise block-scoped.
  let namespace: string | null = null;
  const fileScoped = src.match(/^\s*namespace\s+([A-Za-z_][\w.]*)\s*;/m);
  if (fileScoped) {
    namespace = fileScoped[1]!;
  } else {
    const blockScoped = src.match(/namespace\s+([A-Za-z_][\w.]*)\s*\{/);
    namespace = blockScoped ? blockScoped[1]! : null;
  }

  const resolve = opts.resolveCategoryConstant;
  const classes = extractClasses(src, resolve);
  const methods: ParsedMethod[] = [];
  let isFixture = false;
  for (const cls of classes) {
    // Only an explicit `[TestFixture]` attribute marks a class as a
    // real suite. Setup / teardown-only base classes (e.g.
    // `TestFixture.cs` in scaffolded projects) are intentionally NOT
    // treated as suites — they would otherwise leak into the
    // "Add method to existing suite" dropdown in the Build with AI
    // dialog. A class with real `[Test]` / `[Fact]` methods promotes
    // the file to fixture below.
    if (cls.isFixture) isFixture = true;
    for (const m of extractMethods(cls, resolve)) {
      if (m.isSetupOrTeardown) {
        // Setup/teardown-only methods aren't runnable, but their
        // presence is a strong fixture signal — flag the file so it
        // still surfaces in the "Add method to existing suite"
        // dropdown even without a [TestFixture] attribute or [Test].
        isFixture = true;
        continue;
      }
      const id = namespace
        ? `${namespace}.${cls.name}.${m.name}`
        : `${cls.name}.${m.name}`;
      methods.push({
        id,
        name: m.name,
        tags: [...cls.classTags, ...m.tags],
      });
    }
  }
  if (methods.length > 0) isFixture = true;
  return { namespace, methods, isFixture };
}

/**
 * Parse a `TestCategories/*.cs` companion file and return the
 * `public const string` declarations grouped by their declaring class
 * name. Used by the discovery service to build a project-wide
 * registry of `{Suite}TestCategories.{Const}` -> string-value mappings
 * so the C# parser can resolve `[Trait("Category", X.Y)]` constants
 * to their actual string values.
 *
 * Returns a map of `className -> (memberName -> stringValue)`. Files
 * with no recognizable class or no const-string members yield an
 * empty map.
 */
export function parseCSharpTestCategoriesFile(
  rawSource: string,
): Map<string, Map<string, string>> {
  const src = stripComments(rawSource);
  const out = new Map<string, Map<string, string>>();
  for (const cls of extractClasses(src)) {
    const members = new Map<string, string>();
    const re =
      /(?:public|internal|private|protected|static|const|readonly|\s)+\bstring\s+([A-Za-z_]\w*)\s*=\s*"([^"]*)"\s*;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cls.body)) !== null) {
      members.set(m[1]!, m[2]!);
    }
    if (members.size > 0) {
      out.set(cls.name, members);
    }
  }
  return out;
}

/**
 * Extract top-level class declarations (and the attribute block
 * immediately preceding each `class` keyword) along with their body.
 * We do brace-matching to capture the body so nested classes don't
 * confuse the method scanner.
 */
function extractClasses(
  src: string,
  resolve?: CategoryConstantResolver,
): CsClass[] {
  const out: CsClass[] = [];
  const re =
    /((?:\[[^\]]*\]\s*)*)(?:(?:public|internal|private|protected|static|sealed|abstract|partial)\s+)*class\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const attrBlock = m[1] ?? "";
    const name = m[2]!;
    const openIdx = src.indexOf("{", re.lastIndex);
    if (openIdx === -1) continue;
    const body = sliceBracedBody(src, openIdx);
    if (body === null) continue;
    out.push({
      name,
      classTags: extractCategoryTags(attrBlock, resolve),
      body,
      isFixture: TEST_FIXTURE_ATTR_RE.test(attrBlock),
    });
  }
  return out;
}

/** Given the index of an opening `{`, return the substring inside the matching braces. */
function sliceBracedBody(src: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

interface CsMethod {
  name: string;
  tags: string[];
  /**
   * True when the method only carries setup / teardown attributes
   * (`[SetUp]`, `[OneTimeSetUp]`, `[TearDown]`, `[OneTimeTearDown]`)
   * and is NOT a runnable test method. Such methods are not added to
   * the discovery tree but mark the enclosing file as a fixture so it
   * still surfaces in the "Add method to existing suite" dropdown.
   */
  isSetupOrTeardown: boolean;
}

const TEST_METHOD_ATTR_RE = new RegExp(
  `\\[\\s*${ATTR_NS}(?:Test(?:Case)?|Fact|Theory)\\b`,
);
const SETUP_TEARDOWN_ATTR_RE = new RegExp(
  `\\[\\s*${ATTR_NS}(?:OneTimeSetUp|OneTimeTearDown|SetUp|TearDown)\\b`,
);
const TEST_FIXTURE_ATTR_RE = new RegExp(`\\[\\s*${ATTR_NS}TestFixture\\b`);

/**
 * Find every test-annotated method in a class body — both NUnit
 * (`[Test]` / `[TestCase(...)]`) and xUnit (`[Fact]` / `[Theory]`,
 * including the `[Fact(Skip="…")]` skipped form so the user can still
 * see it in the explorer tree). Picks up any `[Category("…")]` and
 * `[Trait("Category","…")]` siblings on the same attribute block.
 *
 * Also surfaces methods whose attribute block only carries
 * `[SetUp]` / `[OneTimeSetUp]` / `[TearDown]` / `[OneTimeTearDown]`,
 * tagged with `isSetupOrTeardown: true`. These are not runnable tests
 * but they're a strong fixture signal — `parseCSharpFile` uses them
 * to flag the file as a fixture so it still appears in the
 * "existing suite" dropdown even when there's no `[Test]` yet.
 */
function extractMethods(
  cls: CsClass,
  resolve?: CategoryConstantResolver,
): CsMethod[] {
  const out: CsMethod[] = [];
  // Attribute block immediately followed by a method signature. We
  // require a recognized test attribute to appear in the attribute
  // block; non-test methods are ignored.
  const re =
    /((?:\[[^\]]*\]\s*)+)(?:public|private|protected|internal|static|virtual|override|async|\s)+[\w<>?,\s.\[\]]+?\s+([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cls.body)) !== null) {
    const attrBlock = m[1] ?? "";
    const isTest = TEST_METHOD_ATTR_RE.test(attrBlock);
    const isSetupOrTeardown = !isTest && SETUP_TEARDOWN_ATTR_RE.test(attrBlock);
    if (!isTest && !isSetupOrTeardown) continue;
    const name = m[2]!;
    out.push({
      name,
      tags: extractCategoryTags(attrBlock, resolve),
      isSetupOrTeardown,
    });
  }
  return out;
}
