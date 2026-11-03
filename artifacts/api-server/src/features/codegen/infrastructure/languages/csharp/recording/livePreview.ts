/**
 * Pure helpers consumed by the workbench's "live preview" — the
 * suggested-noun, suggested-method-name, and test-body preview the UI
 * shows next to the recorder while a session is in progress. Mirrors
 * the naming / body assembly that `generateSuiteFiles` and the
 * recording service's stop() path will produce, so the on-screen
 * preview matches the eventual on-disk output byte-for-byte.
 */
import type { RecordedAction } from "@/features/codegen/domain/types";
import {
  SELECTOR_KEY_SUFFIX,
  type NamingMode,
  disambiguateMethodName,
  methodNameFromAction,
  normalizeNounForCsharp,
  nounFromSelectorKey,
  selectorKeyFromAction,
} from "./naming";
import {
  suiteConstantsClassName,
  toCsharpMacroIdentifier,
} from "./identifiers";
import {
  csQuotedArg,
  renderApiAssertionLine,
  renderAssertionLine,
  renderRouteMockLine,
  renderWaitLine,
} from "./assertions";
import { buildFillConstants } from "./constants";

/**
 * Compute the suggested auto-generated method name for the most recently
 * recorded selector-bearing action, given the in-session action list. Used
 * by the recorder UI to pre-fill the "Name this action" prompt without
 * waiting for `generateSuiteFiles` to run at stop-time. Mirrors the key &
 * methodIndex assignment logic of `generateSuiteFiles` (in-memory only —
 * does not consult any pre-existing Selectors file on disk).
 */
export function suggestedMethodNameForLastAction(
  actions: RecordedAction[],
  language: string = "csharp",
): string | null {
  const mode: NamingMode = language === "csharp" ? "csharp" : "legacy";
  const last = actions[actions.length - 1];
  if (!last || !last.selector) return null;
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>();
  let fallbackIndex = 0;
  let methodIndex = 0;
  let lastKey: string | null = null;
  // Track auto-generated full method names so the suggestion for the
  // *last* action picks up a `2`/`3`/... suffix when it would otherwise
  // collide with an earlier in-session peer. (csharp mode only —
  // legacy mode encodes the index directly into the name and never
  // collides.)
  const usedAuto = new Set<string>();
  let lastSuggestion: string | null = null;
  for (const a of actions) {
    if (!a.selector) continue;
    methodIndex++;
    if (!bySelector.has(a.selector)) {
      let reused = false;
      for (const [k, v] of valueByKey) {
        if (v === a.selector) {
          bySelector.set(a.selector, k);
          reused = true;
          break;
        }
      }
      if (!reused) {
        let key = selectorKeyFromAction(a, fallbackIndex, mode);
        while (valueByKey.has(key)) {
          fallbackIndex++;
          key =
            mode === "csharp"
              ? `Element${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX}`
              : `Element${fallbackIndex + 1}`;
        }
        const noun =
          mode === "csharp" ? nounFromSelectorKey(key) : key;
        if (noun.startsWith("Element")) fallbackIndex++;
        valueByKey.set(key, a.selector);
        bySelector.set(a.selector, key);
      }
    }
    const key = bySelector.get(a.selector) ?? null;
    if (key) {
      const candidate = methodNameFromAction(a, key, methodIndex, mode);
      const finalName =
        mode === "csharp"
          ? disambiguateMethodName(candidate, usedAuto)
          : candidate;
      if (mode === "csharp") usedAuto.add(finalName);
      if (a === last) {
        lastKey = key;
        lastSuggestion = finalName;
      }
    }
  }
  if (!lastKey) return null;
  return lastSuggestion;
}

/**
 * Like `suggestedMethodNameForLastAction`, but returns just the bare
 * noun (e.g. `LoginButton`) — the form the recorder pre-fills into the
 * "Name this action" prompt. The full decorated method name
 * (`ClickLoginButtonAsync`) is what `suggestedMethodNameForLastAction`
 * returns, and is shown next to the input as a live preview.
 */
export function suggestedActionNounForLastAction(
  actions: RecordedAction[],
): string | null {
  const last = actions[actions.length - 1];
  if (!last || !last.selector) return null;
  // Mirror the selector-key assignment so the noun matches what
  // generateSuiteFiles will end up using.
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>();
  let fallbackIndex = 0;
  let lastKey: string | null = null;
  for (const a of actions) {
    if (!a.selector) continue;
    if (!bySelector.has(a.selector)) {
      let reused = false;
      for (const [k, v] of valueByKey) {
        if (v === a.selector) {
          bySelector.set(a.selector, k);
          reused = true;
          break;
        }
      }
      if (!reused) {
        let key = selectorKeyFromAction(a, fallbackIndex);
        while (valueByKey.has(key)) {
          fallbackIndex++;
          key = `Element${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX}`;
        }
        if (nounFromSelectorKey(key).startsWith("Element")) fallbackIndex++;
        valueByKey.set(key, a.selector);
        bySelector.set(a.selector, key);
      }
    }
    if (a === last) {
      lastKey = bySelector.get(a.selector) ?? null;
    }
  }
  if (!lastKey) return null;
  // Prefer the user-entered noun when present so re-prompting (rename)
  // round-trips cleanly; otherwise fall back to the noun encoded in the
  // selector key.
  if (typeof last.methodName === "string") {
    const n = normalizeNounForCsharp(last.methodName);
    if (n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return n;
  }
  return nounFromSelectorKey(lastKey);
}

/**
 * Compute the per-action method name map for an in-progress recording,
 * mirroring `generateSuiteFiles`'s selector-key + method-name assignment
 * so the workbench can render a live preview of the test body that will
 * be emitted at stop-time. Pure (no I/O); callers pass in any
 * already-on-disk selector entries they want merged so dedup suffixes
 * (`Element2`, `Element3`, ...) match what the file write would produce.
 */
export function computeMethodNamesForActions(
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
  language: string = "csharp",
): Map<RecordedAction, string> {
  const mode: NamingMode = language === "csharp" ? "csharp" : "legacy";
  const bySelector = new Map<string, string>();
  const valueByKey = new Map<string, string>(existingSelectors);
  let fallbackIndex = 0;
  for (const a of actions) {
    if (a.deleted) continue;
    // Assertions are emitted inline as Playwright Expect() calls and do
    // not contribute selector constants or page-object methods, even
    // though some kinds (element-has-text) carry a selector.
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector || bySelector.has(a.selector)) continue;
    let reused = false;
    for (const [k, v] of valueByKey) {
      if (v === a.selector) {
        bySelector.set(a.selector, k);
        reused = true;
        break;
      }
    }
    if (reused) continue;
    let key = selectorKeyFromAction(a, fallbackIndex, mode);
    while (valueByKey.has(key)) {
      fallbackIndex++;
      key =
        mode === "csharp"
          ? `Element${fallbackIndex + 1}${SELECTOR_KEY_SUFFIX}`
          : `Element${fallbackIndex + 1}`;
    }
    const noun = mode === "csharp" ? nounFromSelectorKey(key) : key;
    if (noun.startsWith("Element")) fallbackIndex++;
    valueByKey.set(key, a.selector);
    bySelector.set(a.selector, key);
  }

  const out = new Map<RecordedAction, string>();
  // Track every full-decorated method name we've assigned so a
  // collision inside the same in-progress recording (two actions on
  // the same selector with the same verb, or a user noun that bumps
  // into a peer's auto noun) gets a `2`/`3`/... suffix on the noun
  // — `Click${Noun}Async`, `Click${Noun}2Async`, `Click${Noun}3Async`.
  // Legacy mode encodes the index directly in the name so it never
  // needs separate disambiguation.
  const used = new Set<string>();
  let methodIndex = 0;
  for (const a of actions) {
    if (a.deleted) continue;
    if (a.type === "assert" || a.type === "wait") continue;
    if (!a.selector) continue;
    const key = bySelector.get(a.selector);
    if (!key) continue;
    methodIndex++;
    const candidate = methodNameFromAction(a, key, methodIndex, mode);
    const finalName =
      mode === "csharp"
        ? disambiguateMethodName(candidate, used)
        : candidate;
    if (mode === "csharp") used.add(finalName);
    out.set(a, finalName);
  }
  return out;
}

/**
 * Build the C# test-body lines that `generateSuiteFiles` + recordingService
 * would emit at stop time, given the actions recorded so far. Used by the
 * workbench's live test-body preview so the user can sanity-check the
 * generated code before stopping. Mirrors the body assembly in
 * recordingService.stop().
 */
export function computeTestBodyPreviewLines(
  suiteName: string,
  urlName: string,
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
  language: string = "csharp",
): string[] {
  return computeTestBodyPreview(
    suiteName,
    urlName,
    actions,
    existingSelectors,
    language,
  ).lines;
}

/**
 * Like `computeTestBodyPreviewLines`, but also returns a parallel array
 * mapping each preview line to the session-array index of the
 * `RecordedAction` that produced it (or `null` for setup lines that are
 * not action-derived). Used by the workbench so hovering an action in the
 * recorded-action feed can highlight the matching line(s) in the live
 * test-body preview, and vice versa.
 *
 * The session index is the position of the action in the input
 * `actions` array, which matches the `index` field broadcast on
 * `{ type: "action" }` messages — that is what the UI uses to identify
 * each row in the action feed. Deleted actions and navigations
 * contribute no preview lines, so their indices never appear in
 * `lineActionIndices`.
 */
export function computeTestBodyPreview(
  suiteName: string,
  urlName: string,
  actions: RecordedAction[],
  existingSelectors: Map<string, string> = new Map(),
  language: string = "csharp",
): { lines: string[]; lineActionIndices: Array<number | null> } {
  const actionsVar = "actions";
  const headerInstantiation = `I${suiteName}Actions ${actionsVar} = new ${suiteName}Actions(Page);`;
  const headerGoto = `await Page.GotoAsync(TestConfig.${urlName});`;
  const lines: string[] = [headerInstantiation];
  const lineActionIndices: Array<number | null> = [null];
  // Route mocks must be installed BEFORE the initial navigation so the
  // first request hits the mock. Emit them between the actions
  // instantiation and the goto; the main loop below skips routeMock
  // entries since they were already emitted here.
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.deleted) continue;
    if (a.type !== "routeMock") continue;
    const line = renderRouteMockLine(a);
    if (line) {
      lines.push(line);
      lineActionIndices.push(i);
    }
  }
  lines.push(headerGoto);
  lineActionIndices.push(null);
  // Live actions only; `stop()` filters out deleted actions before
  // generating the test body, so the preview must do the same to stay
  // byte-for-byte aligned. Carry each action's session index through
  // the filter so preview lines can map back to feed rows.
  const liveActions: Array<{ action: RecordedAction; sessionIndex: number }> =
    [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.deleted) continue;
    liveActions.push({ action: a, sessionIndex: i });
  }
  const methodNames = computeMethodNamesForActions(
    liveActions.map((x) => x.action),
    existingSelectors,
    language,
  );
  // Mirror the constants substitution that `stop()` performs so the live
  // preview shows `Constants.UserName` instead of `"batman"` while
  // recording. Disk-side merges with prior recordings are not modeled
  // here — preview operates on in-session actions only.
  const constants = buildFillConstants(
    liveActions.map((x) => x.action),
    methodNames,
  );
  for (const { action: a, sessionIndex } of liveActions) {
    if (a.type === "navigate") continue;
    if (a.type === "assert") {
      const line = renderAssertionLine(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (a.type === "routeMock") {
      // Already emitted between header[0] and header[1] above; skip
      // here to avoid duplication.
      continue;
    }
    if (a.type === "apiAssertion") {
      const line = renderApiAssertionLine(a);
      if (line) {
        lines.push(line);
        lineActionIndices.push(sessionIndex);
      }
      continue;
    }
    if (a.type === "wait") {
      const line = renderWaitLine(a);
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
          ? `${suiteConstantsClassName(suiteName)}.${constName}`
          : csQuotedArg(a.value ?? "");
    }
    lines.push(`await ${actionsVar}.${methodName}(${arg});`);
    lineActionIndices.push(sessionIndex);
  }
  // T003 macro grouping (C# preview only): collapse contiguous runs
  // of actions sharing the same `macroName` into a single
  // `await <MacroName>Steps.RunAsync(actions);` line so the live
  // preview matches what `stop()` will write to disk. Only runs when
  // the language is C# (or the default `csharp` value); other
  // languages keep the inline-line behavior already produced above.
  if (language === "csharp" && actions.some((a) => !a.deleted && a.macroName)) {
    const grouped: string[] = [];
    const groupedIdx: Array<number | null> = [];
    // Carry over the two header lines untouched.
    grouped.push(lines[0]!);
    groupedIdx.push(lineActionIndices[0]!);
    grouped.push(lines[1]!);
    groupedIdx.push(lineActionIndices[1]!);
    let pendingMacro: string | null = null;
    let pendingFirstIdx: number | null = null;
    const flushMacro = () => {
      if (pendingMacro) {
        // Sanitize the user-typed macro name into a valid C#
        // identifier so the preview matches what `stop()` will
        // actually write (`<MacroName>Steps.RunAsync(actions)`).
        const symbol = toCsharpMacroIdentifier(pendingMacro);
        grouped.push(
          `await ${symbol}Steps.RunAsync(${actionsVar});`,
        );
        groupedIdx.push(pendingFirstIdx);
      }
      pendingMacro = null;
      pendingFirstIdx = null;
    };
    for (let i = 2; i < lines.length; i++) {
      const sessionIdx = lineActionIndices[i];
      const action = sessionIdx !== null ? actions[sessionIdx!] : null;
      const macro = action?.macroName ?? null;
      if (macro) {
        if (pendingMacro && pendingMacro !== macro) flushMacro();
        if (!pendingMacro) pendingFirstIdx = sessionIdx ?? null;
        pendingMacro = macro;
        continue;
      }
      if (pendingMacro) flushMacro();
      grouped.push(lines[i]!);
      groupedIdx.push(sessionIdx ?? null);
    }
    if (pendingMacro) flushMacro();
    return { lines: grouped, lineActionIndices: groupedIdx };
  }
  return { lines, lineActionIndices };
}
