import type { AiRunReport, AiRunStep } from "@/features/ai-agent/domain/types";
import { deriveUrlName } from "@/features/ai-agent/infrastructure/urlNaming";
import {
  escapePy,
  firstGotoUrl,
  inferFieldName,
  pyConstName,
  pyHeader,
  pySnakeName,
  snake,
  upperSnake,
} from "./helpers";
import { collectPyConstants } from "./constants";
import { collectPyPageMethods } from "./pageObject";

export interface PyTestArgs {
  runId: string;
  suitePascal: string;
  suiteSnake: string;
  kind: "playwright" | "api" | "unit";
  steps: AiRunStep[];
  report: AiRunReport;
  methodName: string;
  targetMethod: "test" | "beforeEach" | "oneTimeSetUp";
  ignore: boolean;
  ignoreReason: string | null;
}

/**
 * Map the language-agnostic targetMethod onto the pytest hook the
 * framework discovers. The runner has already rejected the
 * `ignore=true` + non-test combination upstream.
 */
export function pyHookFor(target: PyTestArgs["targetMethod"]): {
  isTest: boolean;
  fnName: string;
  inClass: boolean;
} {
  if (target === "beforeEach")
    return { isTest: false, fnName: "setup_method", inClass: true };
  if (target === "oneTimeSetUp")
    return { isTest: false, fnName: "setup_class", inClass: true };
  return { isTest: true, fnName: "", inClass: false };
}

export function pySkipDecorator(ignore: boolean, reason: string | null): string {
  if (!ignore) return "";
  const safe = (reason ?? "").trim() || "Ignored by AI Agent";
  return `@pytest.mark.skip(reason="${escapePy(safe)}")\n`;
}

export function renderPyTest(args: PyTestArgs): string {
  const header = pyHeader(args.runId);
  if (args.kind === "playwright") return renderPyPlaywright(args, header);
  if (args.kind === "api") return renderPyApi(args, header);
  return renderPyUnit(args, header);
}

function renderPyPlaywright(args: PyTestArgs, header: string): string {
  const stmts: string[] = [];
  let pageVar: string | null = null;
  const constsName = `${args.suiteSnake}_constants`;
  const hasConsts = collectPyConstants(args.steps).size > 0;
  const hasPageMethods = collectPyPageMethods(args.steps).length > 0;
  const goto = firstGotoUrl(args.steps);
  const urlConst = goto
    ? pyConstName(
        args.report.urlNames?.find((u) => u.url === goto)?.name ??
          deriveUrlName(goto),
      )
    : null;

  if (hasPageMethods) {
    pageVar = `${args.suiteSnake}_page`;
    stmts.push(`    ${pageVar} = ${args.suitePascal}Page(page)`);
  }
  if (goto && urlConst) stmts.push(`    page.goto(config.${urlConst})`);

  for (const step of args.steps) {
    stmts.push(`    # ${step.input}`);
    let emitted = false;
    for (const c of step.playwrightCalls ?? []) {
      if (c.method === "page.goto") {
        emitted = true;
        continue;
      }
      const verb = snake(step.method?.name ?? "");
      if (!verb || !pageVar) continue;
      if (c.method === "page.click" || c.method === "expect.toBeVisible") {
        stmts.push(`    ${pageVar}.${verb}()`);
        emitted = true;
      } else if (c.method === "page.fill") {
        const constName = upperSnake(inferFieldName(step) ?? "value") || "VALUE";
        stmts.push(`    ${pageVar}.${verb}(${constsName}.${constName})`);
        emitted = true;
      }
    }
    if (!emitted) stmts.push(`    # (unrecognised — review manually)`);
  }

  const imports = ["from playwright.sync_api import Page"];
  if (args.ignore) imports.push("import pytest");
  if (goto && urlConst) imports.push(`import config`);
  if (hasPageMethods) {
    imports.push(`from pages.${args.suiteSnake}_page import ${args.suitePascal}Page`);
  }
  if (hasConsts) {
    imports.push(`from tests.constants import ${constsName}`);
  }

  const hook = pyHookFor(args.targetMethod);
  const skip = pySkipDecorator(args.ignore, args.ignoreReason);
  if (hook.isTest) {
    const fn = `test_${pySnakeName(args.methodName) || `${args.suiteSnake}_ai_authored`}`;
    return [
      header,
      "",
      imports.join("\n"),
      "",
      `${skip}def ${fn}(page: Page) -> None:`,
      ...stmts,
      "",
    ].join("\n");
  }
  // beforeEach / oneTimeSetUp — wrap inside a Test class. pytest's
  // setup_method / setup_class don't have access to the `page`
  // fixture, so we use an autouse fixture that captures `page` onto
  // `self` (or the class, for oneTimeSetUp) and runs the body. The
  // generated statements are rewritten to reference `self.page` (and
  // store the page object on self) so they are valid in this scope.
  const className = `Test${args.suitePascal}`;
  const isClassScope = hook.fnName === "setup_class";
  const target = isClassScope ? "cls" : "self";
  const scopedStmts = stmts.map((l) =>
    l
      .replace(/(^|\s)page\.goto\(/g, `$1${target}.page.goto(`)
      .replace(/^(\s*)([a-z_][a-zA-Z0-9_]*)_page = /, (_m, indent, n) =>
        `${indent}${target}.${n}_page = `,
      )
      .replace(
        /^(\s*)([a-z_][a-zA-Z0-9_]*)_page\.([a-z_][a-zA-Z0-9_]*)\(/,
        (_m, indent, n, fn) => `${indent}${target}.${n}_page.${fn}(`,
      ),
  );
  const body = scopedStmts.map((l) => "    " + l).join("\n");
  if (!imports.some((i) => i === "import pytest")) imports.push("import pytest");
  // Pytest's `setup_method` / `setup_class` are the canonical hook
  // names — emit them by name as the contract requires. Because they
  // do not receive the `page` fixture, we additionally install an
  // autouse fixture that captures `page` onto self/cls before each
  // setup hook runs, so the body can reference `<scope>.page`.
  const fixtureSig = isClassScope
    ? `    @pytest.fixture(autouse=True, scope="class")\n    def _ai_capture_page(cls, page) -> None:\n        cls.page = page`
    : `    @pytest.fixture(autouse=True)\n    def _ai_capture_page(self, page) -> None:\n        self.page = page`;
  const hookSig = isClassScope
    ? `    @classmethod\n    def setup_class(cls) -> None:`
    : `    def setup_method(self, method) -> None:`;
  return [
    header,
    "",
    imports.join("\n"),
    "",
    `class ${className}:`,
    fixtureSig,
    "",
    hookSig,
    body,
    "",
  ].join("\n");
}

function renderPyApi(args: PyTestArgs, header: string): string {
  const stmts: string[] = [];
  for (const step of args.steps) {
    stmts.push(`    # ${step.input}`);
    for (const c of step.httpCalls ?? []) {
      const m = (c.method || "GET").toLowerCase();
      if (m === "assert") {
        if (c.status) stmts.push(`    assert response.status_code == ${c.status}`);
        continue;
      }
      stmts.push(`    response = httpx.${m}("${escapePy(c.url)}")`);
      if (c.status) stmts.push(`    assert response.status_code == ${c.status}`);
    }
  }
  const imports = ["import httpx"];
  if (args.ignore) imports.push("import pytest");
  const skip = pySkipDecorator(args.ignore, args.ignoreReason);
  const hook = pyHookFor(args.targetMethod);
  if (hook.isTest) {
    const fn = `test_${pySnakeName(args.methodName) || `${args.suiteSnake}_api_ai_authored`}`;
    return [
      header,
      "",
      imports.join("\n"),
      "",
      `${skip}def ${fn}() -> None:`,
      "    response = None",
      ...stmts,
      "",
    ].join("\n");
  }
  const sig =
    hook.fnName === "setup_class"
      ? `    @classmethod\n    def ${hook.fnName}(cls) -> None:`
      : `    def ${hook.fnName}(self, method) -> None:`;
  const body = ["    response = None", ...stmts].map((l) => "    " + l).join("\n");
  return [
    header,
    "",
    imports.join("\n"),
    "",
    `class Test${args.suitePascal}:`,
    sig,
    body,
    "",
  ].join("\n");
}

function renderPyUnit(args: PyTestArgs, header: string): string {
  const stmts: string[] = [];
  for (const step of args.steps) {
    stmts.push(`    # ${step.input}`);
    for (const c of step.unitCalls ?? []) {
      const fn = snake(c.function);
      const a = c.args.map((x) => JSON.stringify(x)).join(", ");
      stmts.push(`    assert ${fn}(${a}) == ${JSON.stringify(c.expected)}`);
    }
  }
  const imports = args.ignore ? ["import pytest"] : [];
  const skip = pySkipDecorator(args.ignore, args.ignoreReason);
  const hook = pyHookFor(args.targetMethod);
  if (hook.isTest) {
    const fn = `test_${pySnakeName(args.methodName) || `${args.suiteSnake}_unit_ai_authored`}`;
    return [
      header,
      "",
      ...(imports.length ? [imports.join("\n"), ""] : []),
      `${skip}def ${fn}() -> None:`,
      ...stmts,
      "",
    ].join("\n");
  }
  const sig =
    hook.fnName === "setup_class"
      ? `    @classmethod\n    def ${hook.fnName}(cls) -> None:`
      : `    def ${hook.fnName}(self, method) -> None:`;
  const body = stmts.map((l) => "    " + l).join("\n");
  return [
    header,
    "",
    ...(imports.length ? [imports.join("\n"), ""] : []),
    `class Test${args.suitePascal}:`,
    sig,
    body,
    "",
  ].join("\n");
}
