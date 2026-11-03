import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-fix-broken-step",
    heading: "Workbench — Fixing a broken step",
    intro:
      "When a recorded step fails because the page changed and the old selector no longer matches anything, the validation row exposes a three-path Fix selector dialog so you can repair the test without leaving the workbench. All three paths end in the same dry-run preview before anything is written to disk, and the change is applied across every recording in the current project that references the same selector — plus the on-disk Selectors files for your language. Manual paths always work even when no AI key is configured; AI is strictly additive.",
    walkthrough: [
      "Run a recording or click Validate on a step. When a step fails because of a broken selector, the validation row surfaces two buttons next to the error: Fix with AI and Re-pick element.",
      "Click either button to open the Fix selector dialog. The dialog header shows the broken selector and three tabs: Fix with AI (Sparkles), Re-pick element (MousePointerClick), and Edit text (Settings2). The button you clicked picks the starting tab; you can switch any time.",
      "**Fix with AI tab.** Memento checks whether an AI provider key is configured under Tools → AI Agent. If not, the call-to-action is disabled with a tooltip and the tab shows an empty state with a setup link and two buttons to switch to Re-pick or Edit text instead. If a key is configured, click Suggest a fix with AI. After 5–15 seconds the panel shows the AI's suggested selector, its confidence (high / medium / low), and a one-or-two-sentence explanation. You can edit the suggestion inline before previewing, click Reject & try again to ask for a fresh suggestion, or click Edit in Advanced to hand the suggestion off to the Edit text tab. Clicking Preview replacement shows the same dry-run diff as the manual path; tick the acknowledgement and click Accept & apply to commit. The audit row stamps the AI provider, model, confidence, and token counts for full provenance.",
      "**Re-pick element tab.** Click Start re-pick session. Memento launches a headless Chromium on the failing step's captured page URL and streams a screenshot into the dialog. Click the new location of the element on the screenshot — Memento captures a fresh selector using the same rules the recorder uses for initial recording (data-testid first, then role + accessible name, then text, then CSS), so no copy / paste is needed. The captured selector appears in a green code block; click Preview replacement to see the dry-run, tick the acknowledgement, then Accept & apply. The session is torn down automatically on apply, cancel, or when the dialog closes.",
      "**Edit text tab (power-user).** Type or paste the replacement selector, click Preview replacement, and read the grouped diff: every recording and every on-disk Selectors file the heal will touch, with per-site before / after snippets. Expand a row to see the exact step or line. Tick the I've reviewed the changes acknowledgement to unlock Accept & apply.",
      "After Apply, a toast summarizes the heal (e.g. `Replaced 3 occurrences in 2 recordings and 1 occurrence in 1 selectors file`) and the dialog closes. Re-run the validation — the step should now pass against the new selector.",
    ],
    fields: [
      {
        name: "Fix with AI button — `data-testid=\"button-ai-suggest\"`",
        description:
          "Primary call-to-action on the AI tab. Disabled with a tooltip when the availability probe (`GET /api/selectors/heal/ai-available`) reports no AI key configured, or while the probe is still in flight (button copy: `Checking AI availability…`). Otherwise the button reads `Suggest a fix with AI`; clicking it POSTs `/api/selectors/heal/ai-suggest` with the failing step's context (`oldSelector`, `actionDescription`, `errorMessage`, `pageUrl`, `domSnippet`, `priorSteps`). On success the panel transitions to `data-testid=\"fix-selector-ai-result\"` with `ai-confidence`, `ai-explanation`, and `input-ai-edited` controls. On 404 with `kind:\"not_found\"` the tab flips into the `fix-selector-ai-no-key` empty state; any other error renders `fix-selector-ai-error` with Try again / Switch to manual re-pick / Edit selector text buttons so the user is never stuck.",
      },
      {
        name: "Accept & apply (AI / Re-pick / Edit text)",
        description:
          "The three tabs share the same apply contract: the underlying call is `POST /api/selectors/heal` with `via: \"ai\" | \"repick\" | \"advanced\"`. AI applies additionally forward `aiProvider`, `aiModel`, `aiConfidence`, `aiTokensIn`, and `aiTokensOut` so the resulting `selector_heal` audit row carries full provenance (alongside the suggestion's own `ai_selector_heal_suggest` row written by `/ai-suggest`). The button stays disabled until the dry-run reports at least one replacement AND the acknowledgement checkbox is ticked, so a blind double-click can't paint the whole project with a misspelled selector.",
      },
      {
        name: "Re-pick session lifecycle",
        description:
          "Start re-pick session calls `POST /api/selectors/heal/repick/start` with the captured page URL. The server-side Chromium session is owned by the calling user, scoped to that session id, and torn down on (a) Cancel session, (b) Accept & apply, (c) the dialog unmounting, or (d) idle timeout enforced by the api-server. Picks go through `POST /api/selectors/heal/repick/pick {sessionId, x, y}` where coordinates are translated from the displayed screenshot back to the live viewport. A pick on empty space returns 404 with a guided message rather than a generic error.",
      },
      {
        name: "Audit trail",
        description:
          "Each AI suggestion writes an `ai_selector_heal_suggest` audit row with the provider, model, confidence, and token counts. Each apply (any path) writes a `selector_heal` row with `via`, `oldSelector`, `newSelector`, the per-recording counts, the per-file counts, and — for AI applies — the same provider/model/confidence/tokens echoed back from suggest. Dry-run previews are never audited; only state changes are. Both rows are visible in Settings → Activity for admins.",
      },
      {
        name: "Visibility",
        description:
          "All four signed-in roles (Memento Admin, Admin, Limited Admin, User) can open the Fix selector dialog on any project they're allowed to view. The Re-pick path and the AI suggest path are both behind the standard `requireAdminOrAssignedToCurrentProjectOrOwner` guard, so a Limited Admin with no assignment to the current project gets the same 403 they would for any other write to that project.",
      },
    ],
  },
];
