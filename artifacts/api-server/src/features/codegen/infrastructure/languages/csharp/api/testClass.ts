import type { BuildApiTestSpec } from "./types";
import { ident, apiSuiteTestCategoriesClassName } from "./naming";
import { findMatchingBrace, ensureUsings } from "./csSource";
import { assistantClassNameFor } from "./helperMethod";

/**
 * Build the `[Fact(...)]` attribute and any prepended `[Trait(...)]`
 * line for the given spec. Returns a string ending in `\n` (or with no
 * trailing newline when no trait is emitted) suitable for inlining
 * directly above the method declaration. Multi-line output is indented
 * to four spaces to match the rest of `renderTestMethodBody`.
 */
function renderApiTestAttributes(spec: BuildApiTestSpec, indent: string): string {
  const meta = spec.metadata;
  const reason = meta?.ignoreReason;
  const factAttr =
    reason && reason.length > 0
      ? `[Fact(Skip="${reason.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")]`
      : `[Fact]`;
  const constName = meta?.categoryConstantName;
  const value = meta?.categoryValue;
  const className = apiTestClassNameFromSpec(spec);
  const wantTrait =
    !!constName &&
    constName.length > 0 &&
    value !== null &&
    value !== undefined &&
    `${value}`.length > 0 &&
    !!className;
  if (wantTrait) {
    const cls = apiSuiteTestCategoriesClassName(className!);
    return `${indent}[Trait("Category", ${cls}.${constName})]\n${indent}${factAttr}`;
  }
  return `${indent}${factAttr}`;
}

function apiTestClassNameFromSpec(spec: BuildApiTestSpec): string | null {
  if (spec.testClass.mode === "new") return spec.testClass.className;
  const base = spec.testClass.path.split(/[\\/]/).pop() ?? "";
  return base.replace(/\.cs$/i, "") || null;
}

function renderTestMethodBody(
  spec: BuildApiTestSpec,
  callArgs: string,
): string {
  const attrs = renderApiTestAttributes(spec, "    ");
  if (spec.buildInto === "testMethod") {
    return `${attrs}
    public async Task ${spec.testMethodName}()
    {
        var response = await _assistant.${spec.helperMethodName}(${callArgs});
        _output.WriteLine($"Status: {(int)response.StatusCode} {response.StatusCode}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.IsSuccessStatusCode.Should().BeTrue();
    }`;
  }
  if (spec.buildInto === "oneTimeSetup") {
    return `${attrs}
    public void ${spec.testMethodName}()
    {
        _output.WriteLine($"Status: {(int)_response.StatusCode} {_response.StatusCode}");
        _response.StatusCode.Should().Be(HttpStatusCode.OK);
        _response.IsSuccessStatusCode.Should().BeTrue();
    }`;
  }
  // perTestSetup — re-run helper inside test
  return `${attrs}
    public async Task ${spec.testMethodName}()
    {
        var response = await _assistant.${spec.helperMethodName}(${callArgs});
        _output.WriteLine($"Status: {(int)response.StatusCode} {response.StatusCode}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.IsSuccessStatusCode.Should().BeTrue();
    }`;
}

/** Render a brand-new test class file content. */
export function renderNewTestClass(
  spec: BuildApiTestSpec,
  ns: string,
): string {
  if (spec.testClass.mode !== "new") {
    throw new Error("renderNewTestClass requires mode=new");
  }
  ident(spec.testClass.className, "Test class name");
  ident(spec.testMethodName, "Test method name");

  const assistantClassName = assistantClassNameFor(spec.testClass.className);
  const callArgs = spec.parameters.map((p) => `default(${p.type})!`).join(", ");
  const buildIntoBody = renderTestMethodBody(spec, callArgs);

  const oneTimeAlloc =
    spec.buildInto === "oneTimeSetup"
      ? `        _response = _assistant.${spec.helperMethodName}(${callArgs}).GetAwaiter().GetResult();`
      : "";
  const ctorBody = oneTimeAlloc;

  const wantCategoryUsing =
    !!(spec.metadata?.categoryConstantName &&
      spec.metadata?.categoryValue);
  const categoryUsing = wantCategoryUsing
    ? `\nusing ${ns}.Automation.API.Tests.TestCategories;`
    : "";

  return `using System.Net;
using System.Net.Http;
using ${ns}.Automation.API;
using ${ns}.Automation.API.Constants;
using ${ns}.Automation.API.Infrastructure;
using ${ns}.Automation.API.Tests.APITestingAssistants;
using ${ns}.Automation.API.Tests.Infrastructure;${categoryUsing}
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace ${ns}.Automation.API.Tests.Tests;

[Collection(TestCollections.Api)]
public class ${spec.testClass.className}
{
    private readonly ${assistantClassName} _assistant;
    private readonly ITestOutputHelper _output;
${spec.buildInto === "oneTimeSetup" ? "    private readonly HttpResponseMessage _response;\n" : ""}
    public ${spec.testClass.className}(ApiTestFixture fixture, ITestOutputHelper output)
    {
        _assistant = new ${assistantClassName}(fixture);
        _output = output;
${ctorBody}
    }

${buildIntoBody}
}
`;
}

/**
 * Insert a new `[Fact]` method into an existing test class file. Throws if
 * a method with the same name already exists (callers should let the user
 * pick a different name rather than silently shadow).
 */
export function insertFactIntoExistingClass(
  source: string,
  spec: BuildApiTestSpec,
  ns?: string,
): string {
  ident(spec.testMethodName, "Test method name");
  if (spec.buildInto !== "testMethod") {
    throw new Error(
      "Adding to an existing test class is only supported when buildInto = testMethod (oneTimeSetup/perTestSetup require constructor wiring that this insert path cannot synthesize safely).",
    );
  }
  // When the new method needs a [Trait("Category", X.Y)] attribute, the
  // file must `using` the TestCategories namespace. Insert it ahead of
  // the dup-check so we don't accidentally write a file that won't
  // compile when the namespace was missing.
  if (
    ns &&
    spec.metadata?.categoryConstantName &&
    spec.metadata?.categoryValue
  ) {
    source = ensureUsings(source, [`${ns}.Automation.API.Tests.TestCategories`]);
  }
  const classHeader = /\bpublic\s+(?:partial\s+)?class\s+(\w+)\s*\{/m.exec(
    source,
  );
  if (!classHeader) {
    throw new Error(
      "Target test class file does not contain a recognizable class declaration",
    );
  }
  const bodyStart = classHeader.index + classHeader[0].length;
  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    throw new Error("Target test class file has unbalanced braces");
  }
  const region = source.slice(bodyStart, bodyEnd);
  const dup = new RegExp(
    `\\b(?:Task\\s+|void\\s+)${spec.testMethodName}\\s*\\(`,
  );
  if (dup.test(region)) {
    throw new Error(
      `Test method ${spec.testMethodName} already exists in target class`,
    );
  }
  const callArgs = spec.parameters.map((p) => `default(${p.type})!`).join(", ");
  const body = `\n\n${renderTestMethodBody(spec, callArgs)}\n`;
  return source.slice(0, bodyEnd) + body + source.slice(bodyEnd);
}
