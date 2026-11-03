// API-side per-suite `<Suite>TestCategories.java` rendering + upsert.
import type { BuildApiTestSpec } from "@/features/codegen/infrastructure/apiCsharpCodegen";
import {
  JAVA_IDENT,
  apiSuiteBareName,
  apiSuiteTestCategoriesClassName,
  quoteJavaString,
} from "./apiShared";

/**
 * Render the per-method annotation block (`@Disabled(...)`, `@Tag(...)`,
 * `@Test`) for an API test method. Annotations are emitted at 4-space
 * indent so they line up with the existing `@Test` placement.
 */
export function renderApiMethodAnnotationsJava(
  spec: BuildApiTestSpec,
  testClassName: string,
): string {
  const lines: string[] = [];
  const meta = spec.metadata ?? undefined;
  if (meta?.ignoreReason) {
    lines.push(`    @Disabled(${quoteJavaString(meta.ignoreReason)})`);
  }
  if (meta?.categoryConstantName && meta.categoryValue) {
    const cls = apiSuiteTestCategoriesClassName(testClassName);
    lines.push(`    @Tag(${cls}.${meta.categoryConstantName})`);
  }
  lines.push("    @Test");
  return lines.join("\n");
}

/**
 * Render the per-method body for an API test, prefixed with whatever
 * @Disabled / @Tag annotations the recorder requested. The class-level
 * `@Tag(TestCollections.API)` is unaffected — JUnit allows multiple
 * `@Tag` annotations per element.
 */
export function renderTestMethodBodyJava(
  spec: BuildApiTestSpec,
  testClassName: string,
): string {
  const callArgs = spec.parameters
    .map((p) => `(${p.type}) defaultValue(${JSON.stringify(p.type)})`)
    .join(", ");
  const annotations = renderApiMethodAnnotationsJava(spec, testClassName);
  if (spec.buildInto === "testMethod") {
    return `${annotations}
    void ${spec.testMethodName}() throws java.io.IOException, InterruptedException {
        java.net.http.HttpResponse<String> response = assistant.${spec.helperMethodName}(${callArgs});
        System.out.println("Status: " + response.statusCode());
        org.assertj.core.api.Assertions.assertThat(response.statusCode()).isEqualTo(200);
    }`;
  }
  if (spec.buildInto === "oneTimeSetup") {
    return `${annotations}
    void ${spec.testMethodName}() {
        System.out.println("Status: " + response.statusCode());
        org.assertj.core.api.Assertions.assertThat(response.statusCode()).isEqualTo(200);
    }`;
  }
  return `${annotations}
    void ${spec.testMethodName}() throws java.io.IOException, InterruptedException {
        java.net.http.HttpResponse<String> r = assistant.${spec.helperMethodName}(${callArgs});
        System.out.println("Status: " + r.statusCode());
        org.assertj.core.api.Assertions.assertThat(r.statusCode()).isEqualTo(200);
    }`;
}

/**
 * Render a brand-new per-suite `<Suite>TestCategories.java` containing a
 * single recorded constant. Used by `planApiTestBuildJava` when the
 * recorder set both `categoryConstantName` and `categoryValue`.
 */
export function renderNewApiTestCategoriesFileJava(
  basePkg: string,
  testClassName: string,
  constantName: string,
  value: string,
): string {
  if (!JAVA_IDENT.test(constantName)) {
    throw new Error(
      `TestCategories constant name must be a valid Java identifier: ${constantName}`,
    );
  }
  const cls = apiSuiteTestCategoriesClassName(testClassName);
  const suiteBare = apiSuiteBareName(testClassName);
  return `package ${basePkg}.tests.testcategories;

/** TestCategories tag constants for the ${suiteBare} test suite. */
public final class ${cls} {
    private ${cls}() {}

    public static final String ${constantName} = ${quoteJavaString(value)};
}
`;
}

/**
 * Idempotently upsert a single `public static final String NAME = "value";`
 * constant into an existing `<Suite>TestCategories.java` source. Replaces
 * an existing entry with the same name in place; otherwise inserts before
 * the class close brace.
 */
export function upsertApiTestCategoryConstantJava(
  source: string,
  constantName: string,
  value: string,
): string {
  if (!JAVA_IDENT.test(constantName)) {
    throw new Error(
      `TestCategories constant name must be a valid Java identifier: ${constantName}`,
    );
  }
  const declLine = `    public static final String ${constantName} = ${quoteJavaString(value)};`;
  const declRe = new RegExp(
    `^[\\t ]*public\\s+static\\s+final\\s+String\\s+${constantName}\\s*=\\s*"(?:[^"\\\\]|\\\\.)*"\\s*;[\\t ]*$`,
    "m",
  );
  if (declRe.test(source)) {
    return source.replace(declRe, declLine);
  }
  const lines = source.split(/\r?\n/);
  let classCloseIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\}\s*$/.test(lines[i]!)) {
      classCloseIdx = i;
      break;
    }
  }
  if (classCloseIdx === -1) {
    throw new Error(
      "TestCategories file is missing a class close brace; cannot insert constant",
    );
  }
  let insertAt = classCloseIdx;
  while (insertAt > 0 && lines[insertAt - 1]!.trim() === "") insertAt--;
  const next = [
    ...lines.slice(0, insertAt),
    "",
    declLine,
    ...lines.slice(insertAt),
  ];
  return next.join("\n");
}
