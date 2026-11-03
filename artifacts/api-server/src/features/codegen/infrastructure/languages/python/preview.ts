/**
 * Build the Python test-body lines that `generateSuiteFiles` + the
 * recordingService would emit at stop time, given the actions recorded
 * so far. Used by the workbench's live test-body preview so the user
 * sees the Python code that will be written to disk.
 */
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";
import { constantsClassNameForSuite, pyQuotedArg } from "./naming";
import { computeMethodNamesForActionsPython } from "./methodNaming";
import { buildFillConstantsPython } from "./fillConstants";
import {
  renderApiAssertionLinePython,
  renderAssertionLinePython,
  renderRouteMockLinePython,
  renderWaitLinePython,
} from "./assertions";

export function computeTestBodyPreviewPython(
  suiteName: string,
  urlName: string,
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
): { lines: string[]; lineActionIndices: Array<number | null> } {
  const headerInstantiation = `actions = ${suiteName}Actions(self.page)`;
  const headerGoto = `self.page.goto(self.config["urls"]["${urlName}"])`;
  const lines: string[] = [headerInstantiation];
  const lineActionIndices: Array<number | null> = [null];
  // Route mocks must be installed BEFORE the initial navigation so the
  // first request hits the mock.
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.deleted) continue;
    if (a.type !== "routeMock") continue;
    const line = renderRouteMockLinePython(a);
    if (line) {
      lines.push(line);
      lineActionIndices.push(i);
    }
  }
  lines.push(headerGoto);
  lineActionIndices.push(null);
  const liveActions: Array<{ action: RecordedAction; sessionIndex: number }> =
    [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.deleted) continue;
    liveActions.push({ action: a, sessionIndex: i });
  }
  const methodNames = computeMethodNamesForActionsPython(
    liveActions.map((x) => x.action),
    existingSelectors,
  );
  const constants = buildFillConstantsPython(
    liveActions.map((x) => x.action),
    methodNames,
  );
  for (const { action: a, sessionIndex } of liveActions) {
    if (a.type === "navigate") continue;
    if (a.type === "assert") {
      const line = renderAssertionLinePython(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (a.type === "routeMock") continue;
    if (a.type === "apiAssertion") {
      const line = renderApiAssertionLinePython(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (a.type === "wait") {
      const line = renderWaitLinePython(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (!a.selector) continue;
    const methodName = methodNames.get(a);
    if (!methodName) continue;
    const takesValue = a.type === "fill" || a.type === "select";
    let arg = "";
    if (takesValue) {
      const constName = constants.byMethod.get(methodName);
      arg =
        a.type === "fill" && constName
          ? `${constantsClassNameForSuite(suiteName)}.${constName}`
          : pyQuotedArg(a.value ?? "");
    }
    lines.push(`actions.${methodName}(${arg})`);
    lineActionIndices.push(sessionIndex);
  }
  return { lines, lineActionIndices };
}
